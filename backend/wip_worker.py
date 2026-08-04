"""
wip_worker.py — ONE-SHOT Kanban WIP picker that ACTS via the local model pair.

Rerouted off the dead Hermes ollama-launch bridge (hermes chat -q hangs on
local models — abandoned per MEMORY.md). This worker mirrors the proven
discord_relay.py path: it calls Ollama DIRECTLY via urllib (api/chat,
num_ctx 65536) — no Hermes client in the loop.

Flow (one-shot, then EXITS — no forever-loop, no sprawl):
  1. Read agent_inbox.jsonl + kanban.jsonl, pick the newest task in
     column 'wip' with by='you' that is NOT already claimed/completed.
  2. Ask the model (with memory-folder context, like the relay) to plan the
     work as a STRUCTURED JSON edit-plan: list of {path, old_string,
     new_string}. The model may also say no edits are needed.
  3. Apply each edit with an anchor-checked patch (fail loud if anchor
     missing — never silent-overwrite). Verify with a real read-back.
  4. PUT /api/kanban/<id> {"column":"completed"} so the card closes.
  5. Append a one-line outcome to reasoning_log.md (two-way bleed).
  6. EXIT 0.

Run with the hermes venv python (has nothing special needed — stdlib only):
  pythonw.exe wip_worker.py

Safeguards:
  - Never write_file-overwrites a large file; uses anchor-patch only.
  - Edits are bounded to known project dirs (C:/web, ~/Desktop/Ai).
  - If the model returns garbage / no plan, we DON'T touch files and we DON'T
    close the card — we log and exit 1 so the task stays in 'wip'.
"""
import os
import re
import sys
import json
import time
import threading
import urllib.request
import urllib.error
import requests

import logging
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [WIP-WORKER] %(message)s")
log = logging.getLogger("wip_worker")

# HARD WATCHDOG: a stuck worker (e.g. a slow/hung Ollama call that doesn't
# honour urllib's socket timeout) must NEVER live forever and pile up. If the
# whole run exceeds this, force-exit. The card is left as-is (red if failed).
_WATCHDOG_S = 600
_wd_started = False


def _watchdog():
    log.error("WATCHDOG fired at %ss — forcing exit (stuck Ollama call?)",
              _WATCHDOG_S)
    os._exit(2)


_wd = threading.Timer(_WATCHDOG_S, _watchdog)
_wd.daemon = True
_wd.start()
_wd_started = True
log.info("watchdog armed: %ss", _WATCHDOG_S)

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
# The model pair for the WIP worker: a SMALL fast model (phi4-mini) that
# attempts the edit-plan first, backed by the BIG model (qwen2.5:32b-ctx64k)
# that finishes it when the small one can't emit valid edit-JSON. This mirrors
# the user's defined pair: mini + 32B work together on any model-pair task.
MODEL_FAST = "phi4-mini:3.8b"
MODEL_BIG = "qwen2.5:32b-ctx64k"
HUB = "http://127.0.0.1:5050"
MEMORY_DIR = "~/Desktop/Ai/memory"
KANBAN = os.path.join(HERE, "kanban.jsonl")
INBOX = os.path.join(HERE, "agent_inbox.jsonl")
REASONING = os.path.join(MEMORY_DIR, "reasoning_log.md")

# Edits are only allowed under these roots (defense against model drift).
ALLOWED_ROOTS = [
    "C:/web",
    "~/Desktop/Ai",
    "~/AppData/Local/hermes/skills",
]

USER = None  # filled from .env if needed (not required for local Ollama)


def _strip_think(text):
    if "<think>" in text and "</think>" in text:
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    return text.strip()


def call_ollama(messages, model=MODEL_FAST, num_ctx=None):
    if num_ctx is None:
        # Small model can stay tight; big model needs headroom for full prompts.
        num_ctx = 16384 if model == MODEL_FAST else 65536
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"num_ctx": num_ctx},
    }
    r = requests.post(OLLAMA_URL, json=payload, timeout=(15, 300))
    r.raise_for_status()
    return _strip_think(r.json().get("message", {}).get("content", "") or "")


def read_memory_ctx(limit=1500):
    """Concatenate the extended-memory folder as context (README first)."""
    try:
        files = sorted(os.listdir(MEMORY_DIR))
        out = []
        for fn in files:
            if not fn.endswith(".md"):
                continue
            try:
                txt = open(os.path.join(MEMORY_DIR, fn),
                                encoding="utf-8", errors="replace").read()
                out.append(txt)
            except Exception:
                pass
        blob = "\n\n".join(out)
        return blob[:limit]
    except Exception as e:
        log.warning("memory read failed: %s", e)
        return ""


def load_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def pick_task():
    cards = load_jsonl(KANBAN)
    inbox = load_jsonl(INBOX)
    # RED cards in WIP take priority — they were failed attempts the 32B must
    # redo directly (no mini attempt, no mini shirk risk).
    reds = [c for c in cards
            if c.get("column") == "wip" and c.get("by") == "you" and c.get("red")]
    if reds:
        reds.sort(key=lambda c: c.get("updated") or c.get("created") or "",
                  reverse=True)
        return reds[0], True
    # Otherwise newest 'wip' + by='you' card, not already completed.
    cands = [c for c in cards
             if c.get("column") == "wip" and c.get("by") == "you"]
    if not cands:
        return None, False
    cands.sort(key=lambda c: c.get("updated") or c.get("created") or "",
               reverse=True)
    return cands[0], False


def extract_json_plan(text):
    """Pull a JSON object out of the model's reply, tolerating markdown
    fences and minor truncation/malformation from small models."""
    # strip fenced block
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1)
    s = text.find("{")
    e = text.rfind("}")
    if s < 0 or e <= s:
        return None
    cand = text[s:e + 1]
    # Try directly
    try:
        return json.loads(cand)
    except Exception:
        pass
    # Repair: if it looks truncated (no closing for the edits list / object),
    # append a minimal close and retry once.
    try:
        repaired = cand.rstrip()
        # count unclosed brackets
        depth = 0
        in_str = False
        esc = False
        for ch in repaired:
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
        if depth > 0:
            repaired = repaired + ("}" * depth)
        return json.loads(repaired)
    except Exception:
        pass
    return None


def normalize_plan(plan):
    """Accept multiple model output shapes and normalize to canonical edits list."""
    if isinstance(plan, list):
        # Some models emit a bare list of edit objects. Wrap it.
        return {"edits": [item for item in plan if isinstance(item, dict)]}
    if not isinstance(plan, dict):
        return plan
    # Model returned {"path": "...", "edits": [...]} instead of {"edits": [{"path": "...", ...}]}
    if "edits" in plan and "path" in plan and not (plan.get("edits") or []):
        return plan
    if "edits" in plan and "path" in plan and isinstance(plan["edits"], list):
        flat = []
        for item in plan["edits"]:
            if isinstance(item, dict):
                ed = dict(item)
                if not ed.get("path"):
                    ed["path"] = plan["path"]
                flat.append(ed)
        return {"edits": flat}
    # Model returned {"edit-plan": [...]} instead of {"edits": [...]}
    if "edits" not in plan and "edit-plan" in plan:
        plan = dict(plan)
        plan["edits"] = plan.pop("edit-plan") or []
    # Some models nest it under "instructions" per file; flatten to edits
    if "edits" in plan and isinstance(plan["edits"], list):
        flat = []
        for item in plan["edits"]:
            if isinstance(item, dict):
                if "file" in item and "instructions" in item:
                    # shape: {"file": ..., "instructions": [{"action": "replace", "selector": "...", ...}]}
                    for step in item.get("instructions", []):
                        if isinstance(step, dict):
                            ed = dict(step)
                            ed["path"] = item["file"]
                            flat.append(ed)
                else:
                    flat.append(item)
        plan = dict(plan)
        plan["edits"] = flat
    return plan



def _in_allowed(path):
    ap = os.path.abspath(path)
    return any(ap.startswith(os.path.abspath(r)) for r in ALLOWED_ROOTS)


def apply_edits(plan):
    edits = plan.get("edits") if isinstance(plan, dict) else None
    if not edits:
        return True, "no file edits required"
    done = []
    for ed in edits:
        path = ed.get("path")
        old = ed.get("old_string", "")
        new = ed.get("new_string", "")
        if not path or old is None or new is None:
            raise ValueError(f"malformed edit: {ed!r}")
        if not _in_allowed(path):
            raise ValueError(f"edit path outside allowed roots: {path}")
        if not os.path.exists(path):
            raise ValueError(f"edit target missing: {path}")
        cur = open(path, encoding="utf-8", errors="ignore").read()
        if old and old not in cur:
            raise ValueError(f"anchor not found in {path} (refusing edit)")
        if old:
            nxt = cur.replace(old, new, 1)
        else:
            nxt = cur + "\n" + new
        if nxt == cur:
            raise ValueError(f"edit produced no change in {path}")
        # anchor-checked write (we already verified anchor present)
        with open(path, "w", encoding="utf-8") as f:
            f.write(nxt)
        done.append(path)
    return True, f"applied {len(done)} edit(s): {done}", done


def verify_task(task, edited_paths):
    """After edits are applied, confirm the task is ACTUALLY done by asking the
    BIG model to inspect the real post-edit file contents. Returns
    (done: bool, reason: str). The worker only closes the card if done=True.
    This is the anti-fake-done gate the user demanded."""
    ctx = ""
    seen = set()
    for p in edited_paths:
        ap = os.path.abspath(p)
        if ap in seen:
            continue
        seen.add(ap)
        if os.path.exists(ap):
            body = open(ap, encoding="utf-8", errors="ignore").read()
            cap = 6000 if ap.endswith(".css") else len(body)
            ctx += f"\n--- {ap} (AFTER edits) ---\n{body[:cap]}\n"
    system = (
        "You verify whether a coding task was actually completed by inspecting "
        "the real file contents after edits. Answer ONLY a JSON object: "
        "{\"done\": true|false, \"reason\": \"one short sentence\"}. "
        "done=true ONLY if the requested feature/behavior is genuinely present "
        "in the files. Be strict — if the edit missed the point, done=false. "
        "No commentary outside the JSON."
    )
    user = (
        f"TASK (id={task.get('id')}): {task.get('title')}\n"
        f"DESC: {task.get('desc','')}\n\n"
        f"Files after edits:\n{ctx}\n\n"
        "Is the task actually done? Return JSON."
    )
    try:
        reply = call_ollama([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], model=MODEL_BIG, num_ctx=16384)
        plan = extract_json_plan(reply)
        if plan and isinstance(plan, dict) and "done" in plan:
            return bool(plan.get("done")), str(plan.get("reason", ""))
    except Exception as e:
        log.warning("verify call failed: %s", e)
    return False, "verification could not confirm (model/parse error)"


def close_card(cid):
    payload = json.dumps({"column": "completed"}).encode()
    req = urllib.request.Request(
        f"{HUB}/api/kanban/{cid}", data=payload, method="PUT",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode()


def set_card(cid, red=None, column=None):
    """Update a card's red flag and/or column. Used by the red-card protocol:
    verify-fail -> red=True + column=backlog; red card completed -> red=False."""
    data = {}
    if red is not None:
        data["red"] = bool(red)
    if column is not None:
        data["column"] = column
    if not data:
        return
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{HUB}/api/kanban/{cid}", data=payload, method="PUT",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode()


def append_reasoning(task_id, title, result):
    try:
        stamp = time.strftime("%Y-%m-%d %H:%M")
        line = (f"\n## {stamp} — WIP worker (direct-Ollama) picked up {task_id} "
                f"\"{title}\": {result}\n")
        with open(REASONING, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        log.warning("reasoning write failed: %s", e)


def main():
    task, is_red = pick_task()
    if not task:
        log.info("no 'wip'+by=you task found — nothing to do")
        sys.exit(0)
    tid = task.get("id")
    title = task.get("title", "(untitled)")
    if is_red:
        log.info("picked RED task %s: %s — 32B handles directly", tid, title)
    else:
        log.info("picked task %s: %s", tid, title)

    mem = read_memory_ctx()
    # Build a tight, relevant context for the edit-plan request.
    # The small model runs with num_ctx=16384, so we must NOT dump every
    # file in full. Pick likely targets by task keywords and cap each snippet.
    title_lower = (title or "").lower()
    desc_lower = (task.get("desc") or "").lower()
    query = title_lower + " " + desc_lower

    def _snippet(path, cap=1800):
        try:
            body = open(path, encoding="utf-8", errors="ignore").read()
            return body[:cap]
        except Exception:
            return ""

    file_ctx = ""
    # Always include the JS that drives WIP/kanban behavior.
    if os.path.exists("C:/web/static/kanban.js"):
        file_ctx += "\n--- C:/web/static/kanban.js (current) ---\n" + _snippet("C:/web/static/kanban.js", cap=2200)
    # HTML template only if task smells like layout/button/modal/UI.
    if any(k in query for k in ["ui", "button", "modal", "layout", "page", "html", "hub", "dashboard", "sidebar"]):
        if os.path.exists("C:/web/templates/index.html"):
            file_ctx += "\n--- C:/web/templates/index.html (current) ---\n" + _snippet("C:/web/templates/index.html", cap=2200)
    # CSS only if task explicitly mentions style/theme/color/css.
    if any(k in query for k in ["css", "style", "theme", "color", "animation", "idle", "fire"]):
        if os.path.exists("C:/web/static/synthwave.css"):
            file_ctx += "\n--- C:/web/static/synthwave.css (current) ---\n" + _snippet("C:/web/static/synthwave.css", cap=2200)
    if not file_ctx:
        # Fallback: kanban.js alone if we have nothing else.
        if os.path.exists("C:/web/static/kanban.js"):
            file_ctx += "\n--- C:/web/static/kanban.js (current) ---\n" + _snippet("C:/web/static/kanban.js", cap=2200)

    system = (
        "You are the local model pair acting as a coding agent for the "
        "Command Center project. You have file-editing tools. Given a Kanban "
        "task, decide the minimal correct changes and return ONLY a JSON "
        "object: {\"edits\": [{\"path\": \"...\", \"old_string\": \"...\", "
        "\"new_string\": \"...\"}]}. Use old_string as a UNIQUE anchor copied "
        "verbatim from the file (include surrounding lines). "
        "HARD RULE: if the task describes adding/changing UI or behavior, you "
        "MUST return at least one real edit — never return an empty edits list "
        "for a coding task. Paths MUST be one of the real files shown below "
        "(C:/web/...). NEVER invent paths. No commentary outside the JSON."
    )
    user = (
        f"TASK (id={tid}): {title}\nDESC: {task.get('desc','')}\n\n"
        f"Relevant current files (edit THESE, use exact anchors):\n{file_ctx}\n\n"
        f"Extended memory context:\n{mem}\n\n"
        "Return the JSON edit-plan now."
    )
    try:
        if is_red:
            # RED card: 32B does it directly (no mini attempt — the small model
            # already failed this one; don't give it another shot to shirk).
            log.info("RED card -> 32B direct")
            reply = call_ollama([
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ], model=MODEL_BIG)
            plan = normalize_plan(extract_json_plan(reply) or {})
        else:
            # SMALL model attempts the edit-plan first (fast).
            log.info("fast model starting: %s", MODEL_FAST)
            reply = call_ollama([
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ], model=MODEL_FAST)
            plan = normalize_plan(extract_json_plan(reply) or {})
            log.info("fast model done; plan_keys=%s", list(plan.keys()) if isinstance(plan, dict) else type(plan).__name__)
            if not plan or "edits" not in plan or not (plan.get("edits") or []):
                # Small model shirked or emitted garbage -> BIG model finishes it.
                log.warning("fast model gave no valid plan; escalating to %s",
                            MODEL_BIG)
                try:
                    log.info("big model starting: %s", MODEL_BIG)
                    reply = call_ollama([
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ], model=MODEL_BIG)
                    log.info("big model done; len=%s", len(reply or ""))
                    plan = normalize_plan(extract_json_plan(reply) or {})
                    log.info("big plan parsed; plan_keys=%s", list(plan.keys()) if isinstance(plan, dict) else type(plan).__name__)
                except Exception as e:
                    log.error("ollama call failed: %s", e)
                    append_reasoning(tid, title, f"ollama call failed: {e}")
                    sys.exit(1)
    except Exception as e:
        log.error("ollama call failed: %s", e)
        append_reasoning(tid, title, f"ollama call failed: {e}")
        sys.exit(1)

    if not plan or "edits" not in plan:
        log.error("model returned no valid JSON plan; reply head: %s",
                  reply[:200])
        append_reasoning(tid, title, "model returned no valid plan; no changes")
        sys.exit(1)

    edits = plan.get("edits") or []
    if not edits:
        # Model claims nothing to do. For a task that clearly requires a code
        # change this is almost always the model shirking — do NOT close the
        # card. Leave it in 'wip' so the user sees it wasn't faked-done.
        log.error("model returned empty edits for a real task — refusing to "
                  "close card (likely shirked). Task stays in 'wip'.")
        append_reasoning(tid, title,
                         "model returned no edits; card left in wip (not faked-done)")
        sys.exit(1)

    try:
        ok, msg, edited = apply_edits(plan)
    except Exception as e:
        log.error("edit apply failed: %s", e)
        append_reasoning(tid, title, f"edit apply failed: {e}")
        sys.exit(1)

    # ANTI-FAKE-DONE GATE: verify the task is actually complete before closing.
    done, reason = verify_task(task, edited)
    if not done:
        # VERIFY FAILED: mark the card RED and send it back to Backlog so it's
        # visibly flagged and the 32B picks it up directly next time it's WIP.
        log.error("VERIFY FAILED — task not actually done: %s. Marking RED + "
                  "back to Backlog.", reason)
        try:
            set_card(tid, red=True, column="backlog")
        except Exception as e:
            log.error("set_card(red+backlog) failed: %s", e)
        append_reasoning(tid, title,
                         f"edits applied BUT verify failed: {reason} — "
                         f"card marked RED, back to backlog")
        sys.exit(1)

    # Verified done. If this was a RED card, strip the red flag.
    try:
        if is_red:
            set_card(tid, red=False)
            log.info("RED card cleared (red=False) after verified completion")
    except Exception as e:
        log.warning("red-clear failed (card still closed): %s", e)
    try:
        close_card(tid)
        log.info("card %s closed: %s | verified: %s", tid, msg, reason)
        append_reasoning(tid, title, f"DONE — {msg} | verified: {reason}")
        sys.exit(0)
    except Exception as e:
        log.error("close_card failed (edits applied + verified, card NOT closed): %s", e)
        append_reasoning(tid, title, f"edits applied+verified but close_card failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
