from flask import Flask, render_template, request, jsonify, redirect, url_for, abort, Response, stream_with_context
import os
import sys
import json
import secrets
import time
import subprocess
import re
import random
import urllib.request
from collections import deque
from threading import Lock
import threading
from functools import wraps
from flask import session, flash

# Windows process-creation flags (only used on Windows; safe no-op elsewhere)
if sys.platform.startswith("win"):
    CREATE_NO_WINDOW = 0x08000000
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
else:
    CREATE_NO_WINDOW = 0
    DETACHED_PROCESS = 0
    CREATE_NEW_PROCESS_GROUP = 0
# ensure repo root is importable
sys.path.insert(0, '/')
from agent import runner, installer
from agent.telegram_notifier import TelegramNotifier
from web.secure_store import save_creds, load_creds
from web.desktop_log import read_entries


app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('UI_SECRET', 'dev-secret')
RELAY_TRACE_KEY = os.environ.get('RELAY_TRACE_KEY', 'cc-trace-local')

stream_events = deque()
stream_lock = Lock()

def push_event(message):
    with stream_lock:
        stream_events.append(message)
        if len(stream_events) > 200:
            stream_events.popleft()

@app.route('/stream')
def stream():
    def generate():
        last = 0
        while True:
            with stream_lock:
                while last < len(stream_events):
                    msg = stream_events[last]
                    last += 1
                    body = msg.replace('\n', '\ndata: ')
                    yield f"data: {body}\n\n"
            time.sleep(0.5)
    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@app.route('/events/recent')
def events_recent():
    """Last ~50 streamed events, for backfilling the Control Panel console
    when the tab is (re)opened."""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        abort(403)
    with stream_lock:
        recent = list(stream_events)[-50:]
    return jsonify(recent)


@app.route('/trace/push', methods=['POST'])
def trace_push():
    """Receive a Live Relay Trace event from the (separate) discord_relay
    process and fan it into the shared SSE stream. Localhost + key gated."""
    if request.remote_addr not in ('127.0.0.1', '::1'):
        abort(403)
    if request.headers.get('X-Trace-Key') != RELAY_TRACE_KEY:
        abort(403)
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    text = (data.get('text') or '').strip()
    level = data.get('level') or 'info'
    if not text:
        return jsonify({'ok': False, 'error': 'empty'}), 400
    # prefix so the Relay Trace view can filter these from other stream events
    tag = '⟳ ' if level != 'error' else '⟳ ✖ '
    push_event(tag + text)
    return jsonify({'ok': True})


def _ensure_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_urlsafe(16)
    return session['csrf_token']


@app.context_processor
def inject_csrf_token():
    return {'csrf_token': lambda: _ensure_csrf_token()}


@app.before_request
def set_csrf_token():
    _ensure_csrf_token()


def validate_csrf():
    if request.method != 'POST':
        return True
    token = request.form.get('csrf_token')
    if not token or token != session.get('csrf_token'):
        return False
    return True


@app.route('/')
def index():
    agents = runner.list_agents()
    hub = {
        'pid': os.getpid(),
        'python': sys.executable,
        'relay': _relay_running(),
        'ollama': _ollama_up(),
        'cron': sorted(CRON_JOBS),
    }
    return render_template(
        'index.html',
        agents=agents,
        relay=hub['relay'],
        ollama=hub['ollama'],
        hub=hub,
    )


def admin_required(f):
    @wraps(f)
    def inner(*args, **kwargs):
        if not session.get('admin'):
            return redirect(url_for('admin_login', next=request.path))
        return f(*args, **kwargs)
    return inner


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        if not validate_csrf():
            abort(400, 'Invalid CSRF token')
        pw = request.form.get('password')
        expected = os.environ.get('ADMIN_PASSWORD', 'admin')
        if pw == expected:
            session['admin'] = True
            return redirect(url_for('admin_settings'))
        flash('Invalid password')
    return render_template('admin_login.html')


@app.route('/admin/logout')
def admin_logout():
    session.pop('admin', None)
    return redirect(url_for('index'))


@app.route('/admin/settings', methods=['GET', 'POST'])
@admin_required
def admin_settings():
    current = load_creds() or {}
    if request.method == 'POST':
        if not validate_csrf():
            abort(400, 'Invalid CSRF token')
        bot = request.form.get('bot_token')
        chat = request.form.get('chat_id')
        save_creds({'bot_token': bot, 'chat_id': chat})
        flash('Saved')
        return redirect(url_for('admin_settings'))
    return render_template('admin_settings.html', creds=current)


@app.route('/admin/log')
@admin_required
def admin_log():
    entries = read_entries()
    return render_template('admin_log.html', entries=entries)


@app.route('/agent/<name>')
def agent_page(name):
    manifest = None
    try:
        manifest = runner.load_manifest(name)
    except Exception:
        manifest = {}
    return render_template('agent.html', name=name, manifest=manifest)


@app.route('/instructions')
def instructions():
    # Provide a single page with quick-start instructions for LLMs and agents
    agents = []
    try:
        agents = runner.list_agents()
    except Exception:
        agents = []
    return render_template('instructions.html', agents=agents)


@app.route('/darkmode')
def darkmode():
    # Focused Dark Mode page: toggles between two synthwave presets
    # (Midnight / Neon) via the same CCTheme engine as the Theme Switcher.
    return render_template('darkmode.html')


@app.route('/run', methods=['POST'])
def run_agent_endpoint():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    name = request.form.get('name')
    context_text = request.form.get('context', '{}')
    try:
        ctx = json.loads(context_text)
    except Exception:
        ctx = {}
    try:
        push_event(f"Starting agent: {name}")
        res = runner.run_agent(name, ctx)
        push_event(f"Agent {name} completed. Result: {res}")
        # If user requested Telegram notification, attempt to send it
        notify = request.form.get('notify')
        if notify:
            bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
            chat_id = os.environ.get('TELEGRAM_CHAT_ID')
            creds = load_creds() or {}
            bot_token = bot_token or creds.get('bot_token')
            chat_id = chat_id or creds.get('chat_id')
            if bot_token and chat_id:
                try:
                    t = TelegramNotifier(bot_token, chat_id)
                    # Send a short summary
                    text = f"Agent {name} completed. Result: {res}"
                    t.send(text)
                except Exception:
                    # don't fail the request if notify fails
                    pass

        return jsonify({'ok': True, 'result': res})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


def build_install_command(backend, model, target=''):
    backend = (backend or '').strip().lower()
    model = (model or '').strip()
    if not backend or not model:
        raise ValueError('Backend and model selection are required.')
    if backend == 'ollama':
        return f"ollama pull {model}"
    if backend == 'docker':
        command = f"docker run -d --rm -p 5000:5000 {model}"
        if target:
            command = f"docker run -d --rm --name {target} -p 5000:5000 {model}"
        return command
    if backend == 'transformers':
        return (
            f"pip install transformers accelerate && "
            f"python -c \"from transformers import pipeline; pipeline('text-generation', model='{model}')\""
        )
    raise ValueError('Unsupported installer backend.')


@app.route('/install-llm', methods=['POST'])
def install_llm_endpoint():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    backend = request.form.get('backend')
    model = request.form.get('model')
    target = request.form.get('target', '')
    try:
        command = build_install_command(backend, model, target)
        push_event(f"Generated install command for {backend}: {model}")
        return jsonify({'ok': True, 'command': command, 'backend': backend, 'model': model})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/install', methods=['POST'])
def install_endpoint():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    url = request.form.get('url')
    name = request.form.get('name')
    push_event(f"Installing agent {name or url}...")
    try:
        dest = installer.install_agent_from_url(url, name)
        push_event(f"Installed agent {name or url} to {dest}")
        return jsonify({'ok': True, 'dest': dest})
    except Exception as e:
        push_event(f"Install failed for {name or url}: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


# ------------------------------------------------------------------
# Discord relay control (the "on switch" hub tab)
# ------------------------------------------------------------------
RELAY_SCRIPT = os.path.expanduser(r"C:\Users\mattz\Desktop\Ai\discord_relay.py")
RELAY_LAUNCHER = os.path.expanduser(r"C:\Users\mattz\Desktop\Ai\discord_relay_launcher.bat")
RELAY_VENV_PY = os.path.expanduser(r"C:\Users\mattz\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe")
RELAY_PIDFILE = os.path.expanduser(r"C:\Users\mattz\Desktop\Ai\relay.pid")
RELAY_LOGFILE = os.path.expanduser(r"C:\Users\mattz\Desktop\Ai\relay_out.txt")
OLLAMA_EXE = r"C:\Users\mattz\AppData\Local\Programs\Ollama\ollama.exe"
CRON_JOBS = ["3b56fa6e0b27", "3c17efea16cb"]  # Daily Readiness, Kanban WIP

CREATE_NEW_PROCESS_GROUP = 0x00000200
DETACHED_PROCESS = 0x00000008


def _relay_running():
    """Return True if the relay is alive.

    Primary check: the PID recorded in relay.pid (written by the relay on
    connect). Fallback: scan for a python process whose command line contains
    discord_relay.py (covers cases where the pidfile is stale/missing).
    """
    try:
        with open(RELAY_PIDFILE, encoding='utf-8') as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        return True
    except Exception:
        pass
    # fallback scan via psutil (pure Python — no console window spawned)
    try:
        import psutil
        for p in psutil.process_iter(["cmdline"]):
            cl = " ".join(p.info.get("cmdline") or [])
            if "discord_relay" in cl:
                return True
        return False
    except Exception:
        return False


def _relay_stop():
    """Kill the relay process(es). Returns list of killed pids.

    Kills the pid recorded in relay.pid, plus any python process whose
    command line contains discord_relay (covers orphaned/relaunched copies).
    """
    killed = []
    # 1) pidfile PID
    try:
        with open(RELAY_PIDFILE, encoding='utf-8') as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, 9)
            killed.append(pid)
        except Exception:
            pass
    except Exception:
        pass
    # 2) any process running discord_relay (incl. the .bat launcher) — pure
    #    Python via psutil, no console window spawned
    try:
        import psutil
        for p in psutil.process_iter(["pid", "cmdline"]):
            cl = " ".join(p.info.get("cmdline") or [])
            if "discord_relay" in cl:
                try:
                    p.kill()
                    killed.append(p.info["pid"])
                except Exception:
                    pass
    except Exception:
        pass
    try:
        os.remove(RELAY_PIDFILE)
    except Exception:
        pass
    return sorted(set(killed))


def _ollama_up():
    try:
        r = urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=3)
        return r.status == 200
    except Exception:
        return False


def _ollama_start():
    """Launch the local Ollama server if it isn't already up. Returns True if up.
    Uses CREATE_NO_WINDOW so no console window pops."""
    if _ollama_up():
        return True
    try:
        subprocess.Popen(
            [OLLAMA_EXE, "serve"],
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
            close_fds=True,
        )
    except Exception:
        return False
    # give it a few seconds to come up
    for _ in range(10):
        if _ollama_up():
            return True
        time.sleep(1)
    return _ollama_up()


@app.route('/bot-control')
def bot_control():
    return render_template(
        'bot_control.html',
        relay=_relay_running(),
        ollama=_ollama_up(),
    )


@app.route('/bot/start', methods=['POST'])
def bot_start():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    global RELAY_WANTED
    RELAY_WANTED = True  # switch ON -> watchdog keeps the relay alive
    ollama = _ollama_start()  # boot local model server if it's down
    if _relay_running():
        _sync_cron_to_pair(True)
        return jsonify({'ok': True, 'running': True, 'ollama': ollama})
    try:
        # Launch as a child of the hub (no DETACHED_PROCESS) so that killing the
        # hub process tree also kills the relay — guarantees clean teardown.
        # Use pythonw + CREATE_NO_WINDOW so no console window ever appears.
        relay_py = RELAY_VENV_PY.replace("python.exe", "pythonw.exe")
        if not os.path.exists(relay_py):
            relay_py = RELAY_VENV_PY
        subprocess.Popen(
            [relay_py, RELAY_SCRIPT],
            stdout=open(RELAY_LOGFILE, "a", encoding="utf-8"),
            stderr=subprocess.STDOUT,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500
    _relay_watchdog_ensure()  # start the keep-alive watchdog
    _sync_cron_to_pair(True)  # pair is now active -> enable pair-dependent crons
    return jsonify({'ok': True, 'running': _relay_running(), 'ollama': ollama})


@app.route('/bot/stop', methods=['POST'])
def bot_stop():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    global RELAY_WANTED
    RELAY_WANTED = False  # switch OFF -> watchdog stops keeping it alive
    _sync_cron_to_pair(False)
    killed = _relay_stop()
    return jsonify({'ok': True, 'killed': killed, 'running': _relay_running()})


def _sync_cron_to_pair(active):
    """Resume/pause the model-pair-dependent cron jobs to match the pair's
    on/off state. Activating the model pair (Start bot) enables them; stopping
    it disables them. This prevents the earlier deadlock where crons fired
    while the pair was offline and hung on model-cold-start. Best-effort:
    failures are logged but never break the bot start/stop flow."""
    CRON_JOBS = ["3b56fa6e0b27", "3c17efea16cb"]  # Daily Readiness, Kanban WIP
    action = "resume" if active else "pause"
    try:
        import subprocess as _sp, shutil as _sh
        hermes = _sh.which("hermes") or "hermes"
        for jid in CRON_JOBS:
            _sp.run([hermes, "cron", action, jid], capture_output=True, text=True, timeout=30)
    except Exception as e:
        print("[cron-sync] failed to %s crons: %s" % (action, e))


@app.route('/bot/status')
def bot_status():
    pair_active = False
    try:
        if _relay_running():
            pair_active = True
    except Exception:
        pass
    return jsonify({
        'relay': _relay_running(),
        'ollama': _ollama_up(),
        'pair_active': pair_active,
    })


# ------------------------------------------------------------------
# Kill-all / bring-up
# ------------------------------------------------------------------
@app.route('/bot/killall', methods=['POST'])
def bot_killall():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    global RELAY_WANTED
    RELAY_WANTED = False
    killed = _relay_stop()
    # Ollama
    try:
        _ollama_stop()
    except Exception:
        pass
    # Hub: C:\web\app.py
    try:
        import psutil
        for p in psutil.process_iter(["pid", "cmdline"]):
            cl = " ".join(p.info.get("cmdline") or [])
            if "C:\\web\\app.py" in cl or ("pythonw.exe" in cl and "app.py" in cl):
                try:
                    p.kill()
                    killed.append(p.info["pid"])
                except Exception:
                    pass
    except Exception:
        pass
    # Hermes background services: gateway/serve agents, not the desktop app
    try:
        import psutil
        for p in psutil.process_iter(["pid", "cmdline"]):
            cl = " ".join(p.info.get("cmdline") or [])
            if "hermes_cli.main gateway run" in cl or "hermes_cli.main serve" in cl:
                try:
                    p.kill()
                    killed.append(p.info["pid"])
                except Exception:
                    pass
    except Exception:
        pass
    # Synth launcher duplicates
    try:
        import psutil
        for p in psutil.process_iter(["pid", "cmdline"]):
            cl = " ".join(p.info.get("cmdline") or [])
            if "synth_launcher.py" in cl:
                try:
                    p.kill()
                    killed.append(p.info["pid"])
                except Exception:
                    pass
    except Exception:
        pass
    return jsonify({'ok': True, 'killed': sorted(set(killed)), 'running': _relay_running(), 'ollama': _ollama_up()})


@app.route('/bot/bringup', methods=['POST'])
def bot_bringup():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    global RELAY_WANTED
    RELAY_WANTED = True
    ollama = _ollama_start()
    # Start Discord relay/model pair only
    if not _relay_running():
        relay_py = RELAY_VENV_PY.replace("python.exe", "pythonw.exe")
        if not os.path.exists(relay_py):
            relay_py = RELAY_VENV_PY
        try:
            subprocess.Popen(
                [relay_py, RELAY_SCRIPT],
                stdout=open(RELAY_LOGFILE, "a", encoding="utf-8"),
                stderr=subprocess.STDOUT,
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception:
            pass
        import time as _t
        for _ in range(15):
            if _relay_running():
                break
            _t.sleep(1)
    _relay_watchdog_ensure()
    _sync_cron_to_pair(True)
    return jsonify({'ok': True, 'running': _relay_running(), 'ollama': ollama})


# ------------------------------------------------------------------
# Relay watchdog: while the on/off switch is ON (RELAY_WANTED), keep the
# relay alive. If it crashes/dies, restart it. When OFF, leave it dead.
# This makes "switch ON = model pair reachable in Discord" actually hold,
# instead of the relay silently dying while the switch still reads ON.
# ------------------------------------------------------------------
RELAY_WANTED = False
_RELAY_WATCHDOG_T = None


def _relay_watchdog():
    """Background thread: keep the relay running while RELAY_WANTED is True."""
    import time as _t
    while True:
        _t.sleep(10)
        if not RELAY_WANTED:
            break
        if not _relay_running():
            try:
                relay_py = RELAY_VENV_PY.replace("python.exe", "pythonw.exe")
                if not os.path.exists(relay_py):
                    relay_py = RELAY_VENV_PY
                subprocess.Popen(
                    [relay_py, RELAY_SCRIPT],
                    stdout=open(RELAY_LOGFILE, "a", encoding="utf-8"),
                    stderr=subprocess.STDOUT,
                    creationflags=CREATE_NO_WINDOW,
                )
            except Exception:
                pass


def _relay_watchdog_ensure():
    global _RELAY_WATCHDOG_T
    if _RELAY_WATCHDOG_T is None or not _RELAY_WATCHDOG_T.is_alive():
        _RELAY_WATCHDOG_T = threading.Thread(target=_relay_watchdog, daemon=True)
        _RELAY_WATCHDOG_T.start()


def _ollama_stop():
    """Stop the local Ollama server if it is running."""
    if not _ollama_up():
        return True
    try:
        subprocess.run(["taskkill", "/IM", "ollama.exe", "/F"],
                       capture_output=True, timeout=10,
                       creationflags=CREATE_NO_WINDOW)
    except Exception:
        return False
    return not _ollama_up()


# ------------------------------------------------------------------
# ------------------------------------------------------------------
# Extended-memory (reasoning-log) bleed-over.
# The local model pair (chess route + the Discord relay) reads this folder
# as context so the agent's progress carries into the models' sessions, and
# writes outcomes back to reasoning_log.md (append-only).
#
# MEMORY CONSOLIDATION:
# - Primary memory dir: C:\Users\mattz\Desktop\Ai\memory\
# - Native Hermes memory: C:\Users\mattz\AppData\Local\hermes\memories\
# Both are scanned for markdown files. Native Hermes memory files
# (MEMORY.md, USER.md) are included first so any agent can locate them.
# ------------------------------------------------------------------
MEMORY_DIR = os.path.expanduser(r"C:\Users\mattz\Desktop\Ai\memory")
HERMES_MEMORY_DIR = os.path.expanduser(r"C:\Users\mattz\AppData\Local\hermes\memories")
REASONING_LOG = os.path.join(MEMORY_DIR, "reasoning_log.md")


def _ensure_memory_dirs():
    for d in (MEMORY_DIR, HERMES_MEMORY_DIR):
        try:
            os.makedirs(d, exist_ok=True)
        except Exception:
            pass


def read_memory(max_chars=4000):
    """Concatenate memory markdown for chat/system prompts.

    Priority:
    1. `UNIFIED_MEMORY.md` quick-ref section only (top ~25 lines)
    2. Hermes native `MEMORY.md`, `USER.md`
    3. Other Desktop extended memory files (skipping obvious redirect stubs)

    Caps total to `max_chars` to keep prompts affordable.
    """
    _ensure_memory_dirs()
    chunks = []
    total = 0

    def _add(text):
        nonlocal total
        text = text or ""
        if not text:
            return
        if total + len(text) > max_chars:
            text = text[: max(0, max_chars - total)]
        chunks.append(text)
        total += len(text)

    # 1) Unified quick-ref first — highest signal, lowest noise
    unified = os.path.join(MEMORY_DIR, "UNIFIED_MEMORY.md")
    try:
        if os.path.isfile(unified):
            # Read only the quick-ref portion; save the rest for on-demand lookup.
            with open(unified, encoding="utf-8") as fh:
                lines = fh.readlines()
            # Keep everything up through the first `---` after CANONICAL QUICK REF.
            cutoff = None
            quick_ref_seen = False
            for i, line in enumerate(lines):
                if line.strip() == "## CANONICAL QUICK REF (read this first)":
                    quick_ref_seen = True
                if quick_ref_seen and line.strip() == "---" and i > 5:
                    cutoff = i + 1
                    break
            if cutoff is None:
                cutoff = min(len(lines), 40)
            _add("".join(lines[:cutoff]))
    except Exception:
        pass

    # 2) Native Hermes memory, always MEMORY.md + USER.md first
    try:
        for f in sorted(os.listdir(HERMES_MEMORY_DIR)):
            if not f.endswith(".md"):
                continue
            if f.lower() not in ("memory.md", "user.md"):
                continue
            p = os.path.join(HERMES_MEMORY_DIR, f)
            try:
                with open(p, encoding="utf-8") as fh:
                    _add(fh.read())
            except Exception:
                pass
    except Exception:
        pass

    # 3) Extended memory files — skip obvious redirect stubs to save tokens
    def _is_redirect_stub(text: str) -> bool:
        t = text.strip().lower()
        return (
            t.startswith("# redirect - do not edit this file")
            or "unified_memory.md" in t
            and "single source of truth" in t
        )

    try:
        for f in sorted(os.listdir(MEMORY_DIR)):
            if not f.endswith(".md"):
                continue
            if f.lower() == "unified_memory.md":
                continue
            p = os.path.join(MEMORY_DIR, f)
            try:
                with open(p, encoding="utf-8") as fh:
                    text = fh.read()
                if _is_redirect_stub(text):
                    # Include a tiny pointer instead of the whole file.
                    text = "[TRUNCATED REDIRECT: see UNIFIED_MEMORY.md]\n"
                _add(text)
            except Exception:
                pass
    except Exception:
        pass

    return "\n\n".join(chunks)


def append_reasoning(entry):
    """Append a short, timestamped line to the reasoning log (loopback)."""
    _ensure_memory_dirs()
    try:
        ts = time.strftime("%Y-%m-%d %H:%M")
        with open(REASONING_LOG, "a", encoding="utf-8") as fh:
            fh.write("\n## %s — %s\n" % (ts, entry))
    except Exception:
        pass



def ollama_start():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    up = _ollama_start()
    return jsonify({'ok': True, 'ollama': up})


@app.route('/bot/ollama/stop', methods=['POST'])
def ollama_stop():
    if not validate_csrf():
        return jsonify({'ok': False, 'error': 'Invalid CSRF token'}), 400
    down = _ollama_stop()
    return jsonify({'ok': True, 'ollama': not down})


@app.route('/bot/log')
def bot_log():
    try:
        with open(RELAY_LOGFILE, encoding='utf-8', errors='replace') as f:
            lines = f.readlines()[-60:]
        return jsonify({'log': ''.join(lines)})
    except Exception:
        return jsonify({'log': '(no log yet)'})


# ------------------------------------------------------------------
# Daily Local-AI Readiness Report (Path B: in-hub relay timer).
# A background thread runs the check on an interval when ENABLED, and a
# manual run can be triggered from the Command Center Power Switches tab.
# Fully local: probes Ollama (:11434), the hub (:5050), loaded models,
# VRAM, then writes a report + optionally posts it to Discord via the relay.
# ------------------------------------------------------------------
import threading as _threading
import datetime as _dt

READINESS_ON = False
READINESS_LAST = {"ts": None, "report": ""}
READINESS_LOCK = _threading.Lock()
READINESS_INTERVAL = 24 * 3600  # seconds between automatic runs
_READINESS_TIMER = None


def _readiness_run():
    """Run the local-AI readiness check. Returns a markdown report string."""
    import json as _json
    lines = []
    now = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines.append("# Local-AI Readiness Report")
    lines.append("")
    lines.append("Generated: %s" % now)
    lines.append("")
    # 1) Ollama up?
    ollama_up = False
    models = []
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
            models = [m.get("name") for m in data.get("models", [])]
            ollama_up = True
    except Exception:
        ollama_up = False
    lines.append("- **Ollama (local model server):** %s" % ("UP" if ollama_up else "**DOWN**"))
    if ollama_up:
        lines.append("  - Loaded models (%d): %s" % (len(models), ", ".join(models) if models else "none"))
    # 2) Hub up?
    hub_up = False
    try:
        req = urllib.request.Request("http://127.0.0.1:5050/")
        with urllib.request.urlopen(req, timeout=5) as resp:
            hub_up = (resp.status == 200)
    except Exception:
        hub_up = False
    lines.append("- **Command Center hub (:5050):** %s" % ("UP" if hub_up else "**DOWN**"))
    # 3) VRAM (reuse the GPU stats helper if present)
    try:
        gpus = _gpu_stats()
        for g in gpus:
            # Two honest VRAM lines, matching Task Manager's layout:
            #   - Dedicated (physical) used / capacity (Arc A770 = 16 GB spec)
            #   - Shared (system RAM borrowed) used / total system RAM
            lines.append("- **%s:** util %s%%" % (g.get("name"), g.get("util")))
            lines.append("  - Dedicated VRAM: %s / %s MB (physical)" %
                         (g.get("ded_used_mb"), g.get("ded_total_mb")))
            lines.append("  - Shared VRAM: %s / %s MB (system RAM)" %
                         (g.get("shu_used_mb"), g.get("shu_total_mb")))
    except Exception:
        pass
    # 4) Relay (Discord bot) up?
    relay_up = False
    try:
        req = urllib.request.Request("http://127.0.0.1:5050/bot/status")
        with urllib.request.urlopen(req, timeout=5) as resp:
            s = _json.loads(resp.read().decode("utf-8"))
            relay_up = bool(s.get("relay"))
    except Exception:
        relay_up = False
    lines.append("- **Discord relay / model pair:** %s" % ("running" if relay_up else "stopped"))
    report = "\n".join(lines)
    # Write report to disk
    try:
        out_path = os.path.join(os.path.expanduser("~"), "Desktop", "Ai", "readiness_report.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report + "\n")
    except Exception:
        pass
    # Hand off to Discord via the ONE-SHOT deliver script. It logs in, drains
    # relay_outbox.jsonl to the #cron channel, then EXITS — no lingering process,
    # no sprawl. (The hub can't post directly: bot tokens 403 on guild listing,
    # and the always-on relay is reserved for the live model-pair chat.)
    try:
        outbox = os.path.join(os.path.expanduser("~"), "Desktop", "Ai",
                              "relay_outbox.jsonl")
        with open(outbox, "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": now, "channel": "cron", "text": report}) + "\n")
        deliver = os.path.join(os.path.expanduser("~"), "Desktop", "Ai",
                               "relay_deliver.py")
        pyw = r"C:\Python314\pythonw.exe"
        if os.path.exists(deliver):
            # fire-and-forget, hidden window, self-terminating
            subprocess.Popen([pyw, deliver],
                             creationflags=CREATE_NO_WINDOW,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    return report


def _readiness_loop():
    global _READINESS_TIMER
    if not READINESS_ON:
        return
    try:
        rep = _readiness_run()
        with READINESS_LOCK:
            READINESS_LAST["ts"] = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            READINESS_LAST["report"] = rep
    except Exception:
        pass
    with READINESS_LOCK:
        if READINESS_ON:
            _READINESS_TIMER = _threading.Timer(READINESS_INTERVAL, _readiness_loop)
            _READINESS_TIMER.daemon = True
            _READINESS_TIMER.start()


@app.route('/readiness/toggle', methods=['POST'])
def readiness_toggle():
    global READINESS_ON, _READINESS_TIMER
    on = request.form.get('on', 'true').lower() in ('1', 'true', 'on', 'yes')
    with READINESS_LOCK:
        if on and not READINESS_ON:
            READINESS_ON = True
            _READINESS_TIMER = _threading.Timer(READINESS_INTERVAL, _readiness_loop)
            _READINESS_TIMER.daemon = True
            _READINESS_TIMER.start()
        elif not on and READINESS_ON:
            READINESS_ON = False
            if _READINESS_TIMER:
                _READINESS_TIMER.cancel()
                _READINESS_TIMER = None
    return jsonify({"on": READINESS_ON})


@app.route('/readiness/run', methods=['POST'])
def readiness_run():
    rep = _readiness_run()
    with READINESS_LOCK:
        READINESS_LAST["ts"] = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        READINESS_LAST["report"] = rep
    return jsonify({"ok": True, "ts": READINESS_LAST["ts"], "report": rep})


@app.route('/readiness/status')
def readiness_status():
    with READINESS_LOCK:
        return jsonify({"on": READINESS_ON, "ts": READINESS_LAST["ts"],
                        "report": READINESS_LAST["report"]})


# ------------------------------------------------------------------
# One-click full restart: spawn a relauncher (waits for the port to
# free, boots a fresh hub) then exit this process. The page polls /
# until the new hub answers, then reloads.
# ------------------------------------------------------------------
@app.route('/app/restart', methods=['POST'])
def app_restart():
    import subprocess, threading, time as _t, os as _os
    pyw = r"C:\Python314\pythonw.exe"
    helper = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'relaunch.py')
    # pass THIS process's pid so the relauncher can keep us serving
    # until the new hub is fully warmed up (near zero-downtime restart)
    subprocess.Popen([pyw, helper, str(os.getpid())], creationflags=0x08000000,
                     close_fds=True, cwd=os.path.dirname(os.path.abspath(__file__)))

    def _die():
        _t.sleep(0.6)   # let the response flush first
        _os._exit(0)
    threading.Thread(target=_die, daemon=True).start()
    return jsonify({'ok': True, 'msg': 'restarting'})



# System Monitor: live CPU / RAM / disk / net / GPU(VRAM) stats.
# GPU util + VRAM come from Windows PDH counters (powershell Get-Counter);
# CPU/RAM/disk/net from psutil. GPU query is slow (~1s) so we cache it.
# ------------------------------------------------------------------
import subprocess as _sp
_SYS_CACHE = {"ts": 0.0, "val": None}
_SYS_CACHE_TTL = 1.5


def _system_ram_mb():
    """Total physical system RAM in MB (for the shared-GPU-memory capacity)."""
    try:
        import psutil
        return psutil.virtual_memory().total / 1048576
    except Exception:
        return 0.0


def _gpu_stats():
    import time as _t
    now = _t.time()
    if _SYS_CACHE["val"] is not None and (now - _SYS_CACHE["ts"]) < _SYS_CACHE_TTL:
        return _SYS_CACHE["val"]
    gpus = []
    try:
        # ONE powershell process, ALL four GPU counters at once. Spawning a
        # fresh PowerShell per counter was the cause of the 8s cold / 12s worst
        # case on /sys/stats (each Get-Counter call is ~3s of process startup).
        paths = [
            r'\GPU Engine(*)\Utilization Percentage',
            r'\GPU Adapter Memory(*)\Dedicated Usage',
            r'\GPU Adapter Memory(*)\Total Committed',
            r'\GPU Adapter Memory(*)\Shared Usage',
        ]
        joined = '","'.join(paths)
        ps = ("$c = (Get-Counter -Counter @(\"%s\") -ErrorAction SilentlyContinue);"
              "$c.CounterSamples | Select-Object InstanceName,Path,CookedValue | ConvertTo-Json -Compress"
              % joined)
        o = _sp.run(["powershell.exe", "-NoProfile", "-Command", ps],
                    capture_output=True, text=True, timeout=25,
                    creationflags=CREATE_NO_WINDOW)
        try:
            samples = json.loads(o.stdout or "[]")
            if not isinstance(samples, list):
                samples = [samples]
        except Exception:
            samples = []
        # split the flat sample list back into the four counter groups by Path
        util_samples, mem_samples, tot_samples, shared_samples = [], [], [], []
        for s in samples:
            path = (s.get("Path") or "").lower()
            if "utilization percentage" in path:
                util_samples.append(s)
            elif "dedicated usage" in path:
                mem_samples.append(s)
            elif "total committed" in path:
                tot_samples.append(s)
            elif "shared usage" in path:
                shared_samples.append(s)
        from collections import defaultdict
        phys = defaultdict(lambda: {"util": [], "ded": 0.0, "tot": 0.0, "shu": 0.0})

        def phys_idx(name):
            for tok in (name or "").split("_"):
                if tok.startswith("phys"):
                    try:
                        return int(tok[4:])
                    except Exception:
                        return 0
            return 0
        for s in util_samples:
            name = s.get("InstanceName") or ""
            # Include ALL engine types (3D AND compute), not just engtype_3d:
            # Ollama inference uses the compute engine, which the 3D-only filter
            # was silently dropping (report showed ~0.1% while the GPU churned).
            phys[phys_idx(name)]["util"].append(s.get("CookedValue") or 0.0)
        for s in mem_samples:
            phys[phys_idx(s.get("InstanceName"))]["ded"] += (s.get("CookedValue") or 0.0)
        for s in tot_samples:
            phys[phys_idx(s.get("InstanceName"))]["tot"] += (s.get("CookedValue") or 0.0)
        for s in shared_samples:
            phys[phys_idx(s.get("InstanceName"))]["shu"] += (s.get("CookedValue") or 0.0)
        # Friendly GPU names via WMI (physical adapters only)
        try:
            wmi = _sp.run(
                ["powershell.exe", "-NoProfile", "-Command",
                 "Get-CimInstance Win32_VideoController | Select Name,Status | ConvertTo-Json -Compress"],
                capture_output=True, text=True, timeout=15, creationflags=CREATE_NO_WINDOW)
            raw = _json.loads(wmi.stdout) if wmi.stdout else []
            names = [x.get("Name") for x in raw] if isinstance(raw, list) else [raw.get("Name")]
        except Exception:
            names = []
        for idx in sorted(phys.keys()):
            g = phys[idx]
            # skip adapters with zero memory AND zero util (pure virtual displays)
            if g["ded"] == 0 and g["tot"] == 0 and not g["util"]:
                continue
            # Report PEAK engine utilization for this physical adapter — this is
            # what Task Manager shows (busiest engine), not the mean across all
            # ~200 idle+active engine instances (which dilutes to ~0). Sourced
            # from the same PDH "GPU Engine(*)\Utilization Percentage" counter
            # Task Manager uses, aggregated as max per adapter.
            util_peak = round(max(g["util"]), 1) if g["util"] else 0.0
            # Pick the best-fitting name: prefer a real GPU name over the
            # "StarDesk Virtual Display Adapter".
            nm = names[idx] if idx < len(names) else f"GPU {idx}"
            if not nm or "virtual" in nm.lower():
                # fall back to next non-virtual name
                for cand in names:
                    if cand and "virtual" not in cand.lower():
                        nm = cand; break
            gpus.append({
                "name": nm or f"GPU {idx}",
                "util": util_peak,
                # Dedicated (physical) VRAM: used from PDH Dedicated Usage;
                # capacity is the card's real spec (Arc A770 = 16 GB / 16384 MB).
                # WMI AdapterRAM is wrong for Arc (reports reserved segment), so
                # we use the known physical capacity, clearly labeled.
                "ded_used_mb": round(g["ded"] / 1048576, 0),
                "ded_total_mb": 16384,
                # Shared GPU memory = system RAM borrowed by the GPU. Used from
                # PDH Shared Usage; capacity = total physical system RAM.
                "shu_used_mb": round(g["shu"] / 1048576, 0),
                "shu_total_mb": round(_system_ram_mb(), 0),
            })
    except Exception:
        gpus = []
    _SYS_CACHE["val"] = gpus
    _SYS_CACHE["ts"] = _t.time()
    return gpus


@app.route('/sys/stats')
def sys_stats():
    import psutil
    cpu = psutil.cpu_percent(interval=0.2)
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage('C:\\')
    net = psutil.net_io_counters()
    # per-core for sparkline
    per_core = psutil.cpu_percent(interval=0.0, percpu=True)
    try:
        gpus = _gpu_stats()
    except Exception:
        gpus = []
    return jsonify({
        "cpu": round(cpu, 1),
        "cpu_per_core": [round(x, 1) for x in per_core],
        "ram_used_gb": round(vm.used / 1e9, 1),
        "ram_total_gb": round(vm.total / 1e9, 1),
        "ram_pct": round(vm.percent, 1),
        "disk_used_gb": round(disk.used / 1e9, 1),
        "disk_total_gb": round(disk.total / 1e9, 1),
        "disk_pct": round(disk.percent, 1),
        "net_sent_mb": round(net.bytes_sent / 1e6, 1),
        "net_recv_mb": round(net.bytes_recv / 1e6, 1),
        "gpus": gpus,
        "ollama": _ollama_up(),
    })


# ------------------------------------------------------------------
# Games: chess move from the local model pair (Ollama).
# The browser sends the position + the list of *legal* moves; the model
# only has to pick one. We validate against that list before returning,
# and the client falls back to its built-in engine if we return nothing.
# ------------------------------------------------------------------
CHESS_MODEL = os.environ.get('CHESS_MODEL', 'qwen2.5:32b-ctx64k')


@app.route('/games/ai-move', methods=['POST'])
def games_ai_move():
    data = request.get_json(silent=True) or {}
    legal_moves = data.get('legal') or []
    fen = data.get('fen', '')
    turn = 'Black' if data.get('turn') == 'b' else 'White'
    if not legal_moves:
        return jsonify({'move': None})
    if not _ollama_up():
        return jsonify({'move': None, 'error': 'ollama down'})
    prompt = (
        "You are a chess engine playing as " + turn + ". Board (uppercase=White, "
        "lowercase=Black, '.'=empty), rank 8 at top:\n" + fen + "\n\n"
        "Choose the strongest move for " + turn + " from this list of LEGAL moves:\n"
        + ", ".join(legal_moves) + "\n\n"
        "Reply with ONLY the chosen move exactly as written in the list, nothing else."
    )
    try:
        body = json.dumps({
            "model": CHESS_MODEL,
            "prompt": prompt,
            "system": (
                "You are a precise chess engine. Play legal moves only. "
                "Context from the operator's reasoning log (read before acting):\n"
                + read_memory()
            ),
            "stream": False,
            "options": {"temperature": 0.2, "num_ctx": _model_default_context(CHESS_MODEL)}
        }).encode()
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=45) as r:
            resp = json.loads(r.read().decode())
        raw = (resp.get('response') or '').strip()
        # extract the first legal move found in the reply
        chosen = None
        for mv in sorted(legal_moves, key=len, reverse=True):
            if mv.lower() in raw.lower():
                chosen = mv
                break
        if chosen:
            append_reasoning(f"chess vs Local Model: {turn} played {chosen} (from {len(legal_moves)} legal moves)")
        return jsonify({'move': chosen, 'raw': raw[:120]})
    except Exception as e:
        return jsonify({'move': None, 'error': str(e)})



# ------------------------------------------------------------------
# Model Arena: pit two local Ollama models against each other.
# /arena/models -> installed models; /arena/round -> same prompt to both
# (sequential, VRAM-friendly); /arena/vote -> persist result + scoreboard.
# ------------------------------------------------------------------
ARENA_SCORES = r"C:\Users\mattz\Desktop\Ai\arena_scores.json"


def _arena_load():
    try:
        with open(ARENA_SCORES, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"rounds": [], "score": {}}


def _arena_save(d):
    try:
        with open(ARENA_SCORES, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=1)
    except Exception:
        pass


@app.route('/arena/models')
def arena_models():
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=4) as r:
            tags = json.loads(r.read().decode())
        names = sorted(m.get("name") for m in tags.get("models", []) if m.get("name"))
        fusions = [{"id": f["id"], "name": f["name"], "model_a": f["model_a"],
                    "model_b": f["model_b"]} for f in _fusion_load()["fusions"]]
        return jsonify({"models": names, "fusions": fusions,
                        "scores": _arena_load()["score"]})
    except Exception as e:
        return jsonify({"models": [], "fusions": [], "error": str(e)})


def _arena_ask(model, prompt):
    t0 = time.time()
    try:
        body = json.dumps({
            "model": model, "prompt": prompt, "stream": False,
            "options": {"temperature": 0.7, "num_predict": 512, "num_ctx": _model_default_context(model)},
        }).encode()
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            resp = json.loads(r.read().decode())
        dt = time.time() - t0
        toks = resp.get("eval_count") or 0
        return {
            "text": (resp.get("response") or "").strip(),
            "secs": round(dt, 1),
            "toks": toks,
            "tps": round(toks / dt, 1) if dt > 0 and toks else 0,
            "error": None,
        }
    except Exception as e:
        return {"text": "", "secs": round(time.time() - t0, 1),
                "toks": 0, "tps": 0, "error": str(e)}


@app.route('/arena/round', methods=['POST'])
def arena_round():
    try:
        if request.mimetype == 'application/json' and request.data:
            data = request.get_json(silent=True) or {}
        else:
            payload = request.form.get('payload') or '{}'
            data = json.loads(payload)
    except Exception:
        data = {}
    ma, mb = data.get('model_a'), data.get('model_b')
    prompt = (data.get('prompt') or '').strip()
    if not (ma and mb and prompt):
        return jsonify({"error": "need model_a, model_b, prompt"}), 400
    # sequential on purpose: two 14b+ models at once would thrash Arc VRAM
    a = _arena_ask(ma, prompt)
    b = _arena_ask(mb, prompt)
    return jsonify({"a": a, "b": b})


@app.route('/arena/vote', methods=['POST'])
def arena_vote():
    try:
        if request.mimetype == 'application/json' and request.data:
            data = request.get_json(silent=True) or {}
        else:
            payload = request.form.get('payload') or '{}'
            data = json.loads(payload)
    except Exception:
        data = {}
    ma, mb = data.get('model_a'), data.get('model_b')
    winner = data.get('winner')          # 'a' | 'b' | 'draw'
    prompt = (data.get('prompt') or '')[:200]
    if not (ma and mb and winner in ('a', 'b', 'draw')):
        return jsonify({"error": "bad vote"}), 400
    d = _arena_load()
    for m in (ma, mb):
        d["score"].setdefault(m, {"w": 0, "l": 0, "d": 0})
    if winner == 'draw':
        d["score"][ma]["d"] += 1
        d["score"][mb]["d"] += 1
    else:
        win, lose = (ma, mb) if winner == 'a' else (mb, ma)
        d["score"][win]["w"] += 1
        d["score"][lose]["l"] += 1
    d["rounds"].append({"ts": time.strftime("%Y-%m-%d %H:%M"),
                        "a": ma, "b": mb, "winner": winner, "prompt": prompt})
    d["rounds"] = d["rounds"][-200:]
    _arena_save(d)
    try:   # let the pair's memory know its own record
        append_reasoning(f"arena: {ma} vs {mb} -> winner={winner} ({prompt[:60]!r})")
    except Exception:
        pass
    return jsonify({"ok": True, "scores": d["score"]})


# ------------------------------------------------------------------
# FUSION CORE — named model PAIRS (the same two-model "pair" the Discord
# relay uses: a fast model drafts, a big model finishes). A fusion is a
# callable agent that appears in every model dropdown (arena, maze, chat)
# and can be run through the gauntlet. Creating one plays an evolve anim.
# ------------------------------------------------------------------
FUSIONS_FILE = os.path.join(os.path.dirname(__file__), "fusions.json")


def _fusion_load():
    try:
        with open(FUSIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"fusions": []}


def _fusion_save(d):
    try:
        with open(FUSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=1)
    except Exception:
        pass


# Pair-size guard: prevent two heavyweights from thrashing VRAM. A pair runs
# A fully, then B fully — so only ONE model is resident at a time, but Ollama
# keeps recent models warm, so peak VRAM ~= A + B. Cap the total, and forbid
# two "big" models pairing at all.
FUSION_BIG_THRESH = 14.0      # a single model above this counts as "big"
FUSION_MAX_TOTAL = 48.0       # max total params (billions) across the pair

_PARAM_CACHE = {}


def _parse_params(s):
    if not s:
        return None
    s = str(s).strip().upper().replace("BILLION", "B")
    m = re.match(r"([\d.]+)", s)
    if not m:
        return None
    try:
        v = float(m.group(1))
    except ValueError:
        return None
    if "M" in s:
        v = v / 1000.0
    return v


def _model_param_b(name):
    """Return a model's param size in BILLIONS, or None if unknown/offline."""
    if name in _PARAM_CACHE:
        return _PARAM_CACHE[name]
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=4) as r:
            tags = json.loads(r.read().decode())
        for m in tags.get("models", []):
            if m.get("name") == name:
                b = _parse_params(m.get("details", {}).get("parameter_size"))
                _PARAM_CACHE[name] = b
                return b
    except Exception:
        pass
    _PARAM_CACHE[name] = None
    return None


def _fusion_check_pair(ma, mb):
    """Return (ok, reason). Enforces: not two bigs, and a total-param cap."""
    ba = _model_param_b(ma)
    bb = _model_param_b(mb)
    if ba is None or bb is None:
        # unknown params (offline / not installed) — let it through; the run
        # will fail with a clear error instead of silently blocking.
        return True, ""
    total = ba + bb
    if ba > FUSION_BIG_THRESH and bb > FUSION_BIG_THRESH:
        return False, ("Both models are large (%.1fB + %.1fB). Pair ONE big model "
                       "with a small one — two heavyweights thrash VRAM."
                       % (ba, bb))
    if total > FUSION_MAX_TOTAL:
        return False, ("Pair total %.1fB exceeds the %.0fB cap. Shrink one slot "
                       "(e.g. keep a small drafter like phi4-mini)."
                       % (total, FUSION_MAX_TOTAL))
    return True, ""


def _ollama_chat(model, messages, num_ctx=8192, temperature=0.7):
    """Single Ollama /api/chat call (reuses the relay pair call shape)."""
    body = json.dumps({
        "model": model, "messages": messages, "stream": False,
        "options": {"num_ctx": num_ctx, "temperature": temperature},
    }).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())


def _fusion_run_pair(fus, prompt):
    """model_a drafts, model_b refines -> final answer. Mirrors the relay pair."""
    t0 = time.time()
    sys_msg = ("You are the DRAFT model in a two-model pair. Give a solid, "
               "complete first pass at the user's request. Be concrete.")
    a_msgs = [{"role": "system", "content": sys_msg},
              {"role": "user", "content": prompt}]
    a_resp = _ollama_chat(fus["model_a"], a_msgs)
    draft = (a_resp.get("message", {}).get("content") or "").strip()
    b_sys = ("You are the FINISH model in a two-model pair. The draft below "
             "is from your partner. Polish it into the final, best answer: "
             "fix errors, add rigor, keep what's good. Return only the final answer.")
    b_msgs = [{"role": "system", "content": b_sys},
              {"role": "user", "content": "USER REQUEST:\n" + prompt +
               "\n\nDRAFT FROM PARTNER:\n" + draft}]
    b_resp = _ollama_chat(fus["model_b"], b_msgs)
    final = (b_resp.get("message", {}).get("content") or "").strip()
    return {"draft": draft, "final": final,
            "secs": round(time.time() - t0, 1), "error": None}


@app.route("/arena/fusions")
def fusion_list():
    return jsonify(_fusion_load())


@app.route("/arena/fusion", methods=["POST"])
def fusion_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    ma, mb = data.get("model_a"), data.get("model_b")
    if not (name and ma and mb):
        return jsonify({"error": "need name, model_a, model_b"}), 400
    ok, reason = _fusion_check_pair(ma, mb)
    if not ok:
        return jsonify({"error": reason}), 400
    d = _fusion_load()
    fid = "fx_" + secrets.token_hex(4)
    fus = {"id": fid, "name": name, "model_a": ma, "model_b": mb,
           "created": time.strftime("%Y-%m-%d %H:%M")}
    d["fusions"].append(fus)
    _fusion_save(d)
    return jsonify({"ok": True, "fusion": fus})

@app.route("/arena/fusion/<fid>", methods=["PUT", "DELETE"])
def fusion_edit(fid):
    d = _fusion_load()
    fus = next((f for f in d["fusions"] if f["id"] == fid), None)
    if not fus:
        return jsonify({"error": "not found"}), 404
    if request.method == "DELETE":
        d["fusions"] = [f for f in d["fusions"] if f["id"] != fid]
        _fusion_save(d)
        return jsonify({"ok": True})
    data = request.get_json(silent=True) or {}
    if "name" in data and data["name"].strip():
        fus["name"] = data["name"].strip()
    if "model_a" in data:
        fus["model_a"] = data["model_a"]
    if "model_b" in data:
        fus["model_b"] = data["model_b"]
    ok, reason = _fusion_check_pair(fus["model_a"], fus["model_b"])
    if not ok:
        return jsonify({"error": reason}), 400
    _fusion_save(d)
    return jsonify({"ok": True, "fusion": fus})


@app.route("/arena/fusion/run", methods=["POST"])
def fusion_run():
    data = request.get_json(silent=True) or {}
    fid = data.get("id") or (data.get("fusion") or {}).get("id")
    prompt = (data.get("prompt") or "").strip()
    d = _fusion_load()
    fus = next((f for f in d["fusions"] if f["id"] == fid), None)
    if not fus:
        return jsonify({"error": "unknown fusion"}), 404
    if not prompt:
        return jsonify({"error": "need prompt"}), 400
    try:
        res = _fusion_run_pair(fus, prompt)
        return jsonify({"ok": True, "fusion": fus["name"], "result": res})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/arena/pair/run", methods=["POST"])
def pair_run_temp():
    """Temporary (unsaved) pairing in the Arena 'Pair' mode — same pipeline."""
    data = request.get_json(silent=True) or {}
    ma, mb = data.get("model_a"), data.get("model_b")
    prompt = (data.get("prompt") or "").strip()
    if not (ma and mb and prompt):
        return jsonify({"error": "need model_a, model_b, prompt"}), 400
    ok, reason = _fusion_check_pair(ma, mb)
    if not ok:
        return jsonify({"error": reason}), 400
    fus = {"id": "temp", "name": ma + " → " + mb, "model_a": ma, "model_b": mb}
    try:
        res = _fusion_run_pair(fus, prompt)
        return jsonify({"ok": True, "fusion": fus["name"], "result": res})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


def _fusion_by_id(fid):
    for f in _fusion_load()["fusions"]:
        if f["id"] == fid:
            return f
    return None


# ------------------------------------------------------------------
# Arena MAZE: pit local models against a maze, turn-by-turn.
# /arena/maze -> full solve (JSON, for replay). SSE /arena/maze/stream ->
# live step-by-step so you watch the agent reason.
# ------------------------------------------------------------------
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("maze_engine",
                                     os.path.join(os.path.dirname(__file__),
                                                  "maze_engine.py"))
maze_engine = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(maze_engine)


@app.route("/arena/maze", methods=["POST"])
def arena_maze():
    data = request.get_json(silent=True) or {}
    models = [m for m in (data.get("model_a"), data.get("model_b")) if m]
    models = models[:2]
    if not models:
        return jsonify({"error": "pick at least one model"}), 400
    size = int(data.get("size", 13))
    size = max(9, min(21, size | 1))  # odd, clamped
    grid, start, exit_cell = maze_engine.gen_maze(cols=size, rows=size)
    results = []
    for m in models:
        try:
            res = maze_engine.solve(grid, m, start, exit_cell,
                                    step_cap=int(data.get("cap", 160)))
            results.append(res)
        except Exception as e:
            results.append({"model": m, "error": str(e), "outcome": "error",
                            "steps": [], "final_pos": start, "visited_count": 0})
    # winner = first to exit; else fewest steps; else most visited progress
    def score(r):
        if r.get("outcome") == "exit":
            return (0, len(r.get("steps", [])), 0)
        return (1, -r.get("visited_count", 0), 0)
    ranked = sorted(results, key=score)
    winner = ranked[0]["model"] if ranked and ranked[0].get("outcome") == "exit" else None
    return jsonify({
        "grid": grid, "start": start, "exit": exit_cell,
        "results": results, "winner": winner, "size": size,
    })


@app.route("/arena/maze/stream")
def arena_maze_stream():
    """SSE: live-stepping maze. Query: ?models=a|b&size=13&cap=160"""
    models = [m for m in (request.args.get("model_a"), request.args.get("model_b"))
              if m]
    models = models[:2]
    size = max(9, min(21, int(request.args.get("size", 13)) | 1))
    cap = int(request.args.get("cap", 160))

    def gen():
        yield ": connected\n\n"
        try:
            if not models:
                yield 'event: error\ndata: {"msg":"pick at least one model"}\n\n'
                return
            grid, start, exit_cell = maze_engine.gen_maze(cols=size, rows=size)
            yield 'event: maze\ndata: ' + json.dumps(
                {"grid": grid, "start": start, "exit": exit_cell, "size": size,
                 "models": models}) + "\n\n"
            for m in models:
                yield 'event: agent\ndata: ' + json.dumps({"model": m}) + "\n\n"
                rng = random.Random(1337)
                pos = start
                visited = set([pos])
                outcome = "running"
                consec_revisit = 0
                for i in range(cap):
                    legal = maze_engine.legal_moves(grid, pos)
                    if pos == exit_cell:
                        outcome = "exit"; break
                    if not legal:
                        outcome = "trapped"; break
                    ascii_view = maze_engine.render(grid, pos, exit_cell,
                                                    list(visited))
                    prompt = (
                        "You are trapped inside a maze. '#' = wall, ' ' = open, "
                        "'@' = YOU, 'E' = exit, '.' = your trail:\n\n"
                        f"{ascii_view}\n\nYou are at {pos}. Exit at {exit_cell}. "
                        f"Legal moves: {', '.join(legal)}.\nReply with exactly ONE "
                        "word: up, down, left, or right. No explanation."
                    )
                    try:
                        reply = maze_engine._ollama_chat(m, prompt, num_ctx=4096,
                                                         timeout=45)
                    except Exception as e:
                        yield 'event: step\ndata: ' + json.dumps(
                            {"model": m, "step": i, "pos": pos, "legal": legal,
                             "move": None, "reply": "", "error": str(e)}) + "\n\n"
                        outcome = "error"; break
                    move = maze_engine.parse_move(reply)
                    evt = {"model": m, "step": i, "pos": pos, "legal": legal,
                           "move": move, "reply": reply[:120]}
                    if move is None or move not in legal:
                        evt["illegal"] = True
                        nudged = False
                        for _ in range(2):
                            nudge_prompt = (
                                f"ILLEGAL: '{move}' is not a legal move. From {pos} the only "
                                f"open neighbours are: {', '.join(legal)}. Look at the maze — "
                                f"'#' is wall. Reply with EXACTLY ONE of: {', '.join(legal)}."
                            )
                            try:
                                reply2 = maze_engine._ollama_chat(m, nudge_prompt, num_ctx=4096, timeout=45)
                            except Exception:
                                break
                            move2 = maze_engine.parse_move(reply2)
                            if move2 and move2 in legal:
                                move = move2
                                evt["move"] = move2
                                evt["reply"] = reply2[:120]
                                evt["illegal"] = False
                                evt["nudged"] = True
                                nudged = True
                                break
                        if not nudged:
                            yield 'event: step\ndata: ' + json.dumps(evt) + "\n\n"
                            outcome = "invalid"; break
                    dr, dc = maze_engine.DIRS[move]
                    npos = (pos[0] + dr, pos[1] + dc)
                    evt["revisit"] = npos in visited
                    if npos in visited:
                        consec_revisit += 1
                    else:
                        consec_revisit = 0
                    yield 'event: step\ndata: ' + json.dumps(evt) + "\n\n"
                    pos = npos
                    visited.add(pos)
                    if pos == exit_cell:
                        outcome = "exit"; break
                    if pos == start:
                        outcome = "looping"; break
                    if consec_revisit >= 10:
                        outcome = "looping"; break
                if outcome == "running":
                    outcome = "gaveup"
                yield 'event: done\ndata: ' + json.dumps(
                    {"model": m, "outcome": outcome, "final_pos": pos,
                     "visited": len(visited)}) + "\n\n"
            yield 'event: finish\ndata: {}\n\n'
        except Exception as e:
            yield 'event: error\ndata: ' + json.dumps({"msg": str(e)}) + "\n\n"

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})



# ------------------------------------------------------------------
# FIRE DANGER WIDGET (home hero). 5-stage flame = danger level;
# evac indicator lights = evac order stage. Danger derived from NWS
# Red Flag Warnings (authoritative .gov) + active-incident proxy, with
# a manual override. Evac stage is primarily manual/configurable (no
# clean public API for evac orders) but a configured source can feed it.
# ------------------------------------------------------------------
import urllib.request as _ur
FIRE_STATE = os.path.join(os.path.dirname(__file__), "fire_state.json")
# Region = Umatilla County, OR (ZIP 97838). Edit to your area.
# NWS point lookup is precise to coordinates; fireWeatherZone from api.weather.gov.
# Hermiston, OR coords ~ (45.84, -119.29). Pendleton office (PDT), zone ORZ691.
FIRE_CFG = {
    "zone": "ORZ691",       # NWS fire-weather zone for Umatilla County
    "point": "45.84,-119.29",  # lat,lon for point-based alert lookup
    "label": "Umatilla County, OR",
}
FIRE_STAGE_NAMES = {1: "Low", 2: "Moderate", 3: "High", 4: "Extreme", 5: "Catastrophic"}
EVAC_STAGE_NAMES = {0: "None", 1: "Advisory", 2: "Get Ready / Set",
                    3: "Evacuate / Go", 4: "Mandatory"}


def _fire_load():
    try:
        with open(FIRE_STATE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"danger_level": 1, "evac_stage": 0, "manual": False,
                "notes": "", "sources": [], "last_update": ""}


def _fire_save(s):
    try:
        with open(FIRE_STATE, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=1)
    except Exception:
        pass


def _nws_redflag(area):
    """Return (count, max_severity) of active Red Flag Warnings for the area.

    `area` is treated as an NWS zone id (e.g. ORZ691) OR a lat,lon point.
    Point lookups are precise to the user's coordinates.
    """
    try:
        if "," in area:  # lat,lon point
            url = ("https://api.weather.gov/alerts/active?point=" + area +
                   "&event=Red%20Flag%20Warning")
        else:            # zone id
            url = ("https://api.weather.gov/alerts/active?zone=" + area +
                   "&event=Red%20Flag%20Warning")
        req = _ur.Request(url, headers={"User-Agent": "CC-FireWidget (local)"})
        d = json.loads(_ur.urlopen(req, timeout=12).read().decode())
        feats = d.get("features", [])
        sev = 0
        for f in feats:
            s = (f.get("properties", {}).get("severity") or "").lower()
            if s == "extreme":
                sev = max(sev, 3)
            elif s == "severe":
                sev = max(sev, 2)
            elif s:
                sev = max(sev, 1)
        return len(feats), sev
    except Exception:
        return None, 0


# Edge-triggered Discord alert state: remember the last alerted severity so we
# only ping once per escalation (not on every 30s poll).
FIRE_ALERT_STATE = {"danger": 0, "evac": 0}
FIRE_ALERT_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "Desktop", "Ai",
                                 "discord_fire_alert.py")
FIRE_VENV_PY = os.path.join(os.environ.get("LOCALAPPDATA", ""),
                            "hermes", "hermes-agent", "venv", "Scripts", "python.exe")


def _fire_maybe_alert(st):
    danger = st.get("danger_level", 1)
    evac = st.get("evac_stage", 0)
    alert_danger = danger >= 4
    alert_evac = evac >= 2
    if not (alert_danger or alert_evac):
        # condition cleared -> reset edge so a future escalation re-alerts
        FIRE_ALERT_STATE["danger"] = 0
        FIRE_ALERT_STATE["evac"] = 0
        return
    # only alert if this is a NEW escalation beyond what we last pinged
    if alert_danger and danger <= FIRE_ALERT_STATE["danger"] and \
       alert_evac and evac <= FIRE_ALERT_STATE["evac"]:
        return
    try:
        if alert_danger:
            kind, stage, name = "DANGER", danger, st.get("danger_name", "Extreme")
        else:
            kind, stage, name = "EVAC", evac, st.get("evac_name", "Get Ready")
        region = st.get("region", "your area")
        subprocess.Popen(
            [FIRE_VENV_PY, FIRE_ALERT_SCRIPT, kind, str(stage), name, region],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        FIRE_ALERT_STATE["danger"] = danger
        FIRE_ALERT_STATE["evac"] = evac
    except Exception:
        pass


@app.route("/api/fire/status")
def fire_status():
    st = _fire_load()
    manual = st.get("manual")
    sources = []
    if not manual:
        cnt, sev = _nws_redflag(FIRE_CFG["point"])
        level = 1
        if cnt is None:
            sources.append("NWS: unreachable (using last/override)")
        elif cnt and cnt > 0:
            level = 2 + min(sev, 3)
            sources.append("NWS Red Flag Warnings (Umatilla): %d (sev %d)" % (cnt, sev))
        else:
            sources.append("NWS Red Flag Warnings: none active for your area")
        st["danger_level"] = level
        st["evac_stage"] = 0  # evac is manual-only; auto clears it
        st["sources"] = sources
        st["last_update"] = time.strftime("%Y-%m-%d %H:%M")
        _fire_save(st)
    st["danger_name"] = FIRE_STAGE_NAMES.get(st.get("danger_level", 1), "?")
    st["evac_name"] = EVAC_STAGE_NAMES.get(st.get("evac_stage", 0), "?")
    st["region"] = FIRE_CFG["label"]
    # ---- Discord alert: edge-triggered on escalation ----
    _fire_maybe_alert(st)
    return jsonify(st)


@app.route("/api/fire/set", methods=["POST"])
def fire_set():
    data = request.get_json(silent=True) or {}
    st = _fire_load()
    manual = bool(data.get("manual", True))
    if manual:
        if "danger_level" in data:
            st["danger_level"] = max(1, min(5, int(data["danger_level"])))
        if "evac_stage" in data:
            st["evac_stage"] = max(0, min(4, int(data["evac_stage"])))
    else:
        # switching back to auto: clear manual overrides so NWS derives fresh
        st["danger_level"] = 1
        st["evac_stage"] = 0
    st["manual"] = manual
    if "notes" in data:
        st["notes"] = (data["notes"] or "")[:300]
    st["last_update"] = time.strftime("%Y-%m-%d %H:%M")
    _fire_save(st)
    return jsonify({"ok": True, "state": st})


@app.route('/api/open', methods=['POST'])
def api_open():
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify({'ok': False, 'error': 'no path'}), 400
    try:
        # run detached, hidden window, no console
        subprocess.Popen(path, shell=True, creationflags=CREATE_NO_WINDOW,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return jsonify({'ok': True, 'path': path})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ------------------------------------------------------------------
# Local AI Chat: forwards to the user's local model webhook (localhost:8080),
# keeping everything offline. Falls back to Ollama /api/generate if up.
# ------------------------------------------------------------------
LOCAL_WEBHOOK = os.environ.get('LOCAL_AI_WEBHOOK', 'http://127.0.0.1:8080')

# Chat model profiles the local UI can pick from (kept local; nothing leaves the box).
CHAT_PROFILES = ['auto', 'qwen3:14b-ctx64k', 'alibayram/hunyuan',
                  'qwen2.5:32b', 'deepseek-r1:14b']


@app.route('/api/chat', methods=['POST'])
def api_chat():
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    msg = (data.get('message') or '').strip()
    model = (data.get('model') or 'auto').strip()
    if not msg:
        return jsonify({'ok': False, 'error': 'empty'}), 400
    # FUSION models skip the webhook and run the two-model pair pipeline
    if model.startswith("fusion:"):
        fus = _fusion_by_id(model.split(":", 1)[1])
        if fus:
            try:
                res = _fusion_run_pair(fus, msg)
                return jsonify({"ok": True, "reply": res["final"],
                                "via": "fusion:" + fus["name"], "model": model,
                                "draft": res["draft"], "secs": res["secs"]})
            except Exception as e:
                return jsonify({"ok": False, "error": str(e)}), 500
        return jsonify({"ok": False, "error": "fusion not found"}), 404
    # 1) try the local webhook first; if it fails, fall back to Ollama
    webhook_error = None
    try:
        body = json.dumps({'msg': msg, '__raw__': msg,
                           'model': model if model != 'auto' else ''}).encode()
        req = urllib.request.Request(LOCAL_WEBHOOK, data=body,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode('utf-8', 'replace')
            try:
                j = json.loads(raw)
                reply = j.get('reply') or j.get('text') or j.get('response') or raw
            except Exception:
                reply = raw
            return jsonify({'ok': True, 'reply': reply, 'via': 'webhook', 'model': model})
    except Exception as e_wh:
        webhook_error = 'webhook unreachable'

    # 2) fall back to local Ollama if running
    try:
        if _ollama_up():
            omodel = CHESS_MODEL if model in ('auto', '') else model
            ctx = _model_default_context(omodel)
            body = json.dumps({'model': omodel, 'prompt': msg, 'system': read_memory(),
                               'stream': False, 'options': {'temperature': 0.7, 'num_ctx': ctx}}).encode()
            req = urllib.request.Request('http://127.0.0.1:11434/api/generate', data=body,
                                         headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=90) as r:
                resp = json.loads(r.read().decode())
            return jsonify({'ok': True, 'reply': (resp.get('response') or '').strip(),
                            'via': 'ollama', 'model': omodel, 'context': ctx})
    except Exception:
        pass

    reason = webhook_error or 'no local model reachable'
    return jsonify({'ok': False, 'error': reason}), 503


# Known local-model default context lengths (tokens).
# Keys may be exact model names or prefixes matched by startswith().
_MODEL_CONTEXT_DEFAULTS = {
    'gemma3:4b': 8192,
    'phi4-mini': 4096,
    'qwen2.5:32b-ctx64k': 65536,
    'qwen3:14b-ctx64k': 65536,
    'qwen3:14b': 8192,
    'qwen2.5:14b-ctx64k': 65536,
    'qwen2.5:14b': 8192,
    'qwen2.5:32b-instruct-q4_K_M': 32768,
    'qwen2.5:14b-instruct-q4_K_M': 32768,
    'llama3:8b': 8192,
    'llama3:latest': 8192,
    'alibayram/hunyuan': 8192,
    'neural-chat': 32768,
    'nous-hermes2-mixtral': 32768,
    'nous-hermes2': 8192,
}


def _model_default_context(model_name: str) -> int:
    if not model_name:
        return 8192
    # exact match first
    ctx = _MODEL_CONTEXT_DEFAULTS.get(model_name)
    if ctx:
        return ctx
    # prefix match by base name before any tag
    base = model_name.split(':')[0]
    for key, val in _MODEL_CONTEXT_DEFAULTS.items():
        if key.startswith(base):
            return val
    return 8192


@app.route('/api/chat/context', methods=['GET'])
def api_chat_context():
    model = (request.args.get('model') or 'auto').strip()
    if model in ('auto', ''):
        return jsonify({'preferred_context': 65536, 'actual_context': 65536,
                        'reduced': False, 'model': model})
    actual = _model_default_context(model)
    preferred = 65536
    return jsonify({'preferred_context': preferred, 'actual_context': actual,
                    'reduced': actual < preferred, 'model': model})


@app.route('/api/chat/models', methods=['GET'])
def api_chat_models():
    fusions = ["fusion:" + f["id"] for f in _fusion_load()["fusions"]]
    return jsonify({'profiles': CHAT_PROFILES + fusions})


# ------------------------------------------------------------------
# Webhook Catcher — a LOCAL endpoint that receives incoming webhooks
# (e.g. n8n, your Discord relay, any local tool) and shows them live
# in the hub. Nothing is forwarded off-box. Events persist to a JSONL
# log and a bounded in-memory ring for the live view.
# ------------------------------------------------------------------
INCOMING_LOG = os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'webhook_inbox.jsonl')
_incoming_ring = []          # most-recent-last; capped
INCOMING_CAP = 200

def _incoming_append(entry):
    _incoming_ring.append(entry)
    if len(_incoming_ring) > INCOMING_CAP:
        del _incoming_ring[0]
    try:
        with open(INCOMING_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + '\n')
    except Exception:
        pass

@app.route('/api/incoming', methods=['POST'])
def api_incoming():
    try:
        raw = request.get_data(as_text=True)
    except Exception:
        raw = ''
    # accept either JSON body or form fields
    src = (request.args.get('source') or request.form.get('source') or '').strip()
    if not src and request.is_json:
        try:
            src = (request.get_json(silent=True) or {}).get('source', '')
        except Exception:
            pass
    entry = {
        'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
        'source': src or 'unknown',
        'ip': (request.remote_addr or '?'),
        'body': raw[:2000],
    }
    _incoming_append(entry)
    return jsonify({'ok': True, 'event': entry})

# ------------------------------------------------------------------
# Kanban board — a SHARED task board between you and the agent.
# Cards persist to a JSONL file in Desktop\Ai so BOTH sides can
# read/add/move them (you via the UI, the agent via its tools).
# Columns: 'backlog' | 'wip' | 'completed'  (Backlog -> WIP -> Completed)
# ------------------------------------------------------------------
KANBAN_FILE = os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'kanban.jsonl')
_kanban_lock = __import__('threading').Lock()
COLUMNS = ['backlog', 'wip', 'completed']

def _kanban_load():
    cards = []
    try:
        with open(KANBAN_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    cards.append(json.loads(line))
                except Exception:
                    pass
    except FileNotFoundError:
        pass
    return cards

def _kanban_save(cards):
    try:
        os.makedirs(os.path.dirname(KANBAN_FILE), exist_ok=True)
        tmp = KANBAN_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            for c in cards:
                f.write(json.dumps(c, ensure_ascii=False) + '\n')
        os.replace(tmp, KANBAN_FILE)
    except Exception:
        pass

def _kanban_next_id(cards):
    n = 0
    for c in cards:
        try:
            n = max(n, int(str(c.get('id', '0')).replace('k', '')) or 0)
        except Exception:
            pass
    return 'k' + str(n + 1)

@app.route('/api/kanban', methods=['GET'])
def api_kanban_get():
    return jsonify({'cards': _kanban_load(), 'columns': COLUMNS})

@app.route('/api/kanban', methods=['POST'])
def api_kanban_post():
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'ok': False, 'error': 'need title'}), 400
    desc = (data.get('desc') or '').strip()
    col = (data.get('column') or 'backlog')
    if col not in COLUMNS:
        col = 'backlog'
    with _kanban_lock:
        cards = _kanban_load()
        card = {
            'id': _kanban_next_id(cards),
            'title': title,
            'desc': desc,
            'column': col,
            'created': time.strftime('%Y-%m-%d %H:%M'),
            'updated': time.strftime('%Y-%m-%d %H:%M'),
            'by': (data.get('by') or 'you'),
        }
        cards.append(card)
        _kanban_save(cards)
    # notify the agent ONLY for cards you (the user) add — not the agent's own
    # verify/test spam. This keeps the inbox a clean "user wants attention" signal.
    if (data.get('by') or 'you') != 'agent':
        _inbox_append({
            'ts': time.strftime('%Y-%m-%d %H:%M'),
            'event': 'kanban_create',
            'title': title,
            'column': col,
            'by': (data.get('by') or 'you'),
        })
        # if you created it straight into WIP, that's an explicit wave
        if col == 'wip':
            _inbox_append({
                'ts': time.strftime('%Y-%m-%d %H:%M'),
                'event': 'kanban_in_progress',
                'title': title,
                'by': (data.get('by') or 'you'),
            })
    return jsonify({'ok': True, 'card': card})

@app.route('/api/kanban/<cid>', methods=['PUT'])
def api_kanban_put(cid):
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    with _kanban_lock:
        cards = _kanban_load()
        found = None
        for c in cards:
            if str(c.get('id')) == str(cid):
                found = c
                break
        if not found:
            return jsonify({'ok': False, 'error': 'not found'}), 404
        if 'column' in data and data['column'] in COLUMNS:
            prev_col = found.get('column')
            found['column'] = data['column']
            if data['column'] == 'wip' and prev_col != 'wip':
                # you moved it to WIP — wave at the agent
                _inbox_append({
                    'ts': time.strftime('%Y-%m-%d %H:%M'),
                    'event': 'kanban_in_progress',
                    'title': found.get('title', ''),
                    'by': (data.get('by') or 'you'),
                })
        if 'title' in data:
            found['title'] = (data['title'] or '').strip()
        if 'desc' in data:
            found['desc'] = (data['desc'] or '').strip()
        if 'by' in data:
            found['by'] = data['by']
        if 'red' in data:
            found['red'] = bool(data['red'])
        found['updated'] = time.strftime('%Y-%m-%d %H:%M')
        _kanban_save(cards)
    return jsonify({'ok': True, 'card': found})

@app.route('/api/kanban/<cid>', methods=['DELETE'])
def api_kanban_delete(cid):
    with _kanban_lock:
        cards = _kanban_load()
        new = [c for c in cards if str(c.get('id')) != str(cid)]
        if len(new) == len(cards):
            return jsonify({'ok': False, 'error': 'not found'}), 404
        _kanban_save(new)
    return jsonify({'ok': True})


@app.route('/api/chat/ping', methods=['GET'])
def api_chat_ping():
    # report which local endpoints are reachable
    out = {'webhook': False, 'ollama': False}
    try:
        req = urllib.request.Request(LOCAL_WEBHOOK, method='HEAD', timeout=3)
        urllib.request.urlopen(req, timeout=3).close()
        out['webhook'] = True
    except Exception:
        pass
    try:
        urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:11434/api/tags', timeout=3), timeout=3)
        out['ollama'] = True
    except Exception:
        pass
    return jsonify(out)


@app.route('/api/discord/send', methods=['POST'])
def api_discord_send():
    # Queue a message for the Discord relay delivery (local, no live gateway
    # call here — the relay_deliver.py drains relay_outbox.jsonl to a channel).
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    ch = (data.get('channel') or '').strip().lstrip('#')
    msg = (data.get('message') or '').strip()
    if not ch or not msg:
        return jsonify({'ok': False, 'error': 'need channel + message'}), 400
    try:
        outbox = os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'relay_outbox.jsonl')
        ts = time.strftime('%Y-%m-%d %H:%M')
        entry = {'ts': ts, 'channel': ch, 'text': msg, 'queued': True, 'status': 'queued', 'delivery_attempts': 0}
        with open(outbox, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + '\n')
        return jsonify({'ok': True, 'queued': True, 'entry': entry})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/nyx/ask', methods=['POST'])
def api_nyx_ask():
    # Bridge: lets the Discord relay invoke the REAL Hermes agent (callsign "Nyx")
    # by @mentioning it. Runs `hermes chat -q` as a subprocess with a hard timeout
    # so a slow/cold model load can never hang the Discord relay. Returns the
    # cleaned reply text. No persona proxy — this is genuine Hermes.
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    prompt = (data.get('prompt') or '').strip()
    if not prompt:
        return jsonify({'ok': False, 'error': 'need prompt'}), 400
    hermes = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'hermes',
                          'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
    if not os.path.exists(hermes):
        hermes = 'hermes'
    try:
        flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(
            [hermes, 'chat', '-q', prompt],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=flags,
        )
        try:
            raw, _ = proc.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            try:
                os.kill(proc.pid, 9)
            except Exception:
                pass
            try:
                os.kill(-proc.pid, 9)
            except Exception:
                pass
            return jsonify({'ok': False, 'error': 'Nyx timed out (120s hard limit)'}), 504
        raw = raw or ''
        clean = re.sub(r'\x1b\[[0-9;]*m', '', raw)
        lines = []
        for ln in clean.splitlines():
            s = ln.strip()
            if not s:
                continue
            if s.startswith('─') or s.startswith('╭') or s.startswith('╰') or s.startswith('│'):
                continue
            if 'Initializing agent' in s or 'Query:' in s or 'Resume this session' in s \
               or s.startswith('hermes --resume') or s.startswith('Session:') \
               or s.startswith('Duration:') or s.startswith('Messages:') \
               or s.startswith('─') :
                continue
            lines.append(s)
        reply = '\n'.join(lines).strip()
        if not reply:
            reply = '(Nyx returned no text)'
        return jsonify({'ok': True, 'reply': reply})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# Clean teardown: if the hub process dies (crash, manual kill, Ctrl+C),
# kill any relay it spawned so nothing lingers.
# ------------------------------------------------------------------
def _cleanup_on_exit():
    try:
        _relay_stop()
    except Exception:
        pass


import atexit
atexit.register(_cleanup_on_exit)

try:
    import signal

    def _sig_handler(signum, frame):
        _cleanup_on_exit()
        os._exit(0)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)
except Exception:
    pass


# ------------------------------------------------------------------
# Live-reload version ping + human version string.
# The open tab polls /api/version every couple seconds; when the agent
# edits the app it bumps the version (via /api/version/bump or
# bump_version()), and the tab reloads itself — no manual refresh.
# The version string is V<MAJOR>.<MINOR>.<BUILD> where BUILD is a
# monotonic counter in cc_build.txt (incremented on every bump).
# ------------------------------------------------------------------
APP_MAJOR, APP_MINOR = 2, 34
BUILD_FILE = os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'cc_build.txt')
APP_VERSION = int(time.time())   # epoch, used for the live-reload "did it change" check


def _build_num():
    try:
        return int(open(BUILD_FILE, encoding='utf-8').read().strip() or '0')
    except Exception:
        return 0


def bump_version():
    global APP_VERSION
    APP_VERSION = int(time.time())
    try:
        n = _build_num() + 1
        with open(BUILD_FILE, 'w', encoding='utf-8') as f:
            f.write(str(n))
    except Exception:
        pass


def version_string():
    return 'V%d.%d.%d' % (APP_MAJOR, APP_MINOR, _build_num())


# Agent inbox: durable queue of things you did in the UI that should
# prompt the agent to read. Written when you add a Kanban card or move
# one to WIP. The agent reads it on its next turn.
AGENT_INBOX = os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'agent_inbox.jsonl')


def _inbox_append(entry):
    try:
        with open(AGENT_INBOX, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + '\n')
    except Exception:
        pass


@app.route('/api/version', methods=['GET'])
def api_version():
    return jsonify({'version': APP_VERSION, 'string': version_string()})


@app.route('/api/version/bump', methods=['POST'])
def api_version_bump():
    bump_version()
    return jsonify({'ok': True, 'version': APP_VERSION, 'string': version_string()})


@app.route('/api/hub/status')
def api_hub_status():
    import shlex, time
    py = sys.executable
    pid = os.getpid()
    try:
        start = psutil.Process(pid).create_time()
        uptime = time.time() - start
    except Exception:
        uptime = 0
    return jsonify({
        'pid': pid,
        'python': py,
        'uptime_sec': round(uptime, 1),
        'routes': sorted(list(app.blueprints.keys()) + [r.rule for r in app.url_map.iter_rules() if not r.rule.startswith('/static')]),
        'relay': _relay_running(),
        'ollama': _ollama_up(),
        'cron': sorted(CRON_JOBS),
        'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
    })


@app.route('/api/hub/stale')
def api_hub_stale():
    try:
        me = os.getpid()
        items = []
        for p in psutil.process_iter(['pid', 'cmdline', 'cwd', 'exe', 'create_time']):
            try:
                cl = ' '.join((p.info.get('cmdline') or []))
                exe = (p.info.get('exe') or '').lower()
                cwd = (p.info.get('cwd') or '')
            except Exception:
                continue
            if not cl:
                continue
            stale = False
            reason = ''
            # duplicate hub runners from C:\web\app.py
            if ('C:\\web\\app.py' in cl or 'C:/web/app.py' in cl) and ('python.exe' in exe or 'pythonw.exe' in exe):
                try:
                    if p.info['pid'] != me:
                        stale = True
                        reason = 'duplicate hub'
                except Exception:
                    pass
            # hermes terminal bash wrappers older than 30 minutes
            if not stale and 'bash.exe' in exe and ('hermes-snap-' in cl or 'eval ' in cl):
                age = time.time() - (p.info.get('create_time') or 0)
                if age > 1800:
                    stale = True
                    reason = 'old terminal wrapper'
            if stale:
                items.append({
                    'pid': p.info.get('pid'),
                    'reason': reason,
                    'cmd': cl[:160],
                    'age_sec': int(time.time() - (p.info.get('create_time') or time.time())),
                })
        items.sort(key=lambda x: x['age_sec'], reverse=True)
        return jsonify({'count': len(items), 'items': items[:20]})
    except Exception as e:
        return jsonify({'count': 0, 'items': [], 'error': str(e)})


@app.route('/api/hub/kill', methods=['POST'])
def api_hub_kill():
    def _kill():
        time.sleep(0.6)
        try:
            os.kill(os.getpid(), 9)
        except Exception:
            try:
                os._exit(1)
            except Exception:
                pass

    threading.Thread(target=_kill, daemon=True).start()
    return jsonify({'ok': True})


@app.route('/changelog')
def changelog():
    entries = [
        {
            'section': 'Hub & Backend',
            'summary': 'Turned the CC hub into a persistent local service with live status, a killswitch, and watchdog-driven automation.',
            'bullets': [
                'Added `/api/hub/status` and `/api/hub/kill` endpoints.',
                'Added `/bot/killall` and `/bot/bringup` routes for AI/automation process management.',
                'Rebound hub to `0.0.0.0:5000` for LAN/phone access.',
                'Persisted hub via `pythonw.exe` so it survives UI close.',
                'Set auto-start `Command Center.lnk` to minimized launch.',
            ],
        },
        {
            'section': 'Hub Dashboard (Home Page)',
            'summary': 'Integrated a live hub dashboard directly on the home page with per-component status lights and a script viewer.',
            'bullets': [
                'Hub process, relay, ollama, and cron indicators with 4s refresh.',
                'Expandable script viewer listing all active endpoints.',
                'Hub killswitch with confirmation modal on home page.',
                'Auto-refresh via `/api/hub/status` and live uptime/PID display.',
            ],
        },
        {
            'section': 'Fire Watch Widget',
            'summary': 'Added a dedicated Fire Watch widget below the hub info on home, pulling live fire danger state.',
            'bullets': [
                'New `/api/fire/status` endpoint drives the widget.',
                'Displays danger stage, region, evac status, sources, and notes.',
                'Badge switches between `LIVE` and `ACTIVE`.',
                'Auto-refreshes every 15 seconds.',
            ],
        },
        {
            'section': 'Power Switches & Bot Control',
            'summary': 'Moved bot control onto a dedicated Power Switches page with explicit toggles and a visual pair status indicator.',
            'bullets': [
                'Killswitch UI block added to `/bot-control` page.',
                'Model pair status indicator (`ONLINE`/`OFFLINE`) with 4s AJAX refresh.',
                'Independent toggle controls for relay and Ollama.',
                'Bring-up now restores one agent pair only, avoiding full respawn storms.',
            ],
        },
        {
            'section': 'Relay & Automation',
            'summary': 'Wired Discord relay under hub watchdog control with start/stop, pid tracking, and log capture.',
            'bullets': [
                '`_relay_running()`, `_relay_start()`, `_relay_stop()` helpers added.',
                'Relay uses venv Python and pidfile for clean restarts.',
                'Cron jobs paused/resumed with pair state to prevent deadlocks.',
            ],
        },
        {
            'section': 'Kanban',
            'summary': 'Built and stabilized the shared kanban board, then cleared the backlog of UI and behavior issues.',
            'bullets': [
                'Full kanban board with backlog, WIP, done columns.',
                'k24 fixed global flex clipping with `.tab-panel > * { min-width:0; flex-shrink:1; }`.',
                'k25 disabled idle particle system by removing `idlefx.js` script tag.',
                '`idlefx.js` rewritten to 183 clean lines after patch tool mangled paths.',
                'WIP retry and self-healing UI added.',
            ],
        },
        {
            'section': 'Theme & UI Polish',
            'summary': 'Applied synthwave styling across hub pages and fixed visual/layout bugs.',
            'bullets': [
                'Synthwave CSS: dark purple panels, neon accents, Orbitron + Share Tech Mono.',
                'Hero gradient, synth sun, stars, horizon grid backgrounds.',
                'Hero spinning glyph removed (k2).',
                'Theme switcher added (k3).',
                'Flicker mitigation and browser re-verify (k14–k16).',
            ],
        },
        {
            'section': 'Android Mobile APK',
            'summary': 'Scaffolded and shipped a fullscreen WebView APK for LAN/Tailscale access to the CC hub.',
            'bullets': [
                'Android Studio configured with Gradle toolchains + Java 17.',
                'Debug and release APKs built, signed, and installed via wireless ADB.',
                'Cleartext HTTP fixed via `network_security_config`.',
                'Hub switcher, swipe-to-refresh, error overlay, wake lock, mobile CSS injection added in v1.1.',
                'Tailscale-first hub resolution and auto-LAN rebinding implemented.',
            ],
        },
        {
            'section': 'Voice & Audio',
            'summary': 'Enabled voice I/O and removed unwanted idle behavior.',
            'bullets': [
                'STT/TTS configured in Hermes voice mode.',
                'Mic-toggle bridge implemented with real system input.',
                'Idle particle system disabled per user request.',
                'TTS playback delay flagged for new-session config apply.',
            ],
        },
        {
            'section': 'Buzz Integration',
            'summary': 'Connected Buzz into Hermes via native platform plugin and drafted local model agents.',
            'bullets': [
                'Native `buzz-platform` plugin enabled in Hermes v0.19.1.',
                'Buzz CLI wrapper created and verified.',
                'Nexus agent live on Hermes Agent harness with `stepfun/step-3.7-flash`.',
                'Buzz Desktop Ollama provider configured via `openai/openai-compat` shim.',
                'Gateway SSL disconnect diagnosed; clean state after restart.',
            ],
        },
        {
            'section': 'Reliability & Housekeeping',
            'summary': 'Hardened startup behavior, killed duplicate processes, and patched build/runtime issues.',
            'bullets': [
                'Auto-start processes set to minimized to stop desktop popups.',
                'Duplicate relay/launcher/hub processes detected and cleaned.',
                'Patch tool backslash mangling diagnosed and bypassed with exact-line replacement.',
                'Template `endblock` duplicate fixed after Jinja syntax error.',
                '`CRON_JOBS` promoted to module scope for `/api/hub/status` access.',
            ],
        },
        {
            'section': 'Plugins & Skills',
            'summary': 'Shipped three native Hermes desktop plugins and saved reusable workflows as skills.',
            'bullets': [
                'Kanban plugin: read/update board from desktop.',
                'Achievements plugin: track milestones.',
                'Composio manager plugin scaffolded.',
                'Saved skills: `android-wireless-deploy`, `windows-process-loop-diagnosis`, others.',
            ],
        },
    ]
    return render_template('changelog.html', entries=entries, version=APP_VERSION, string=version_string())
    # Event-driven trigger: the user confirmed a task into WIP via the
    # caution modal. Record a clean "user wants this picked up" flag and the
    # caller (kanban.js) will fire the agent job. We just persist the intent
    # here so the agent job has a durable signal to read.
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        data = {}
    title = (data.get('title') or '').strip()
    cid = (data.get('id') or '').strip()
    _inbox_append({
        'ts': time.strftime('%Y-%m-%d %H:%M'),
        'event': 'kanban_in_progress',
        'title': title,
        'id': cid,
        'by': 'you',
        'confirmed': True,
    })
    return jsonify({'ok': True})


def api_wip_run():
    # Event-driven: the user confirmed a task into WIP. Fire the
    # WIP picker so it actually DOES the task (instead of a polling loop).
    #
    # REROUTED off the dead Hermes ollama-launch bridge (hermes chat -q hangs
    # on local models — abandoned per MEMORY.md). The picker is now
    # C:/Users/mattz/Desktop/Ai/wip_worker.py, which calls Ollama DIRECTLY
    # (urllib api/chat, num_ctx 65536) — the same proven path the Discord
    # relay uses. One-shot: it edits + closes the card, then EXITS.
    #
    # WAKE-ON-WIP: if the local Ollama server is asleep, boot it so the
    # worker's first call doesn't cold-start-timeout.
    try:
        import subprocess
        # (1) ensure Ollama is up; boot it if not
        if not _ollama_up():
            _ollama_start()
        # (2) warm the model so the worker's first inference doesn't stall.
        model = 'qwen3:14b-ctx64k'
        try:
            subprocess.Popen([OLLAMA_EXE, 'run', model, ''],
                             creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        except Exception:
            pass  # non-fatal: worker will attempt the call regardless
        # (3) launch the direct-Ollama WIP worker (one-shot, fire-and-forget)
        worker_py = os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'wip_worker.py')
        relay_py = RELAY_VENV_PY.replace('python.exe', 'pythonw.exe')
        if not os.path.exists(relay_py):
            relay_py = RELAY_VENV_PY
        subprocess.Popen([relay_py, worker_py],
                         stdout=open(os.path.join(os.path.expanduser('~'), 'Desktop', 'Ai', 'wip_worker.log'), 'a', encoding='utf-8'),
                         stderr=subprocess.STDOUT,
                         creationflags=CREATE_NO_WINDOW)
        return jsonify({'ok': True, 'started': 'kanban-wip-worker', 'ollama_woken': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('FLASK_PORT', '5000')),
            debug=True, use_reloader=False)
