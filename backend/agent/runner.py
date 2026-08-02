import json
import os
import subprocess
import sys
import time

INSTALLED_AGENTS_DIR = os.path.abspath(
    os.path.join(os.path.expanduser("~"), "Desktop", "Ai", "installed_agents")
)


def _agent_dir(name: str) -> str:
    safe = os.path.basename(name)
    return os.path.join(INSTALLED_AGENTS_DIR, safe)


def _agent_path(name: str, filename: str) -> str:
    return os.path.join(_agent_dir(name), filename)


def _is_installed(name: str) -> bool:
    d = _agent_dir(name)
    return os.path.isdir(d) and (
        os.path.isfile(_agent_path(name, "manifest.json"))
        or os.path.isfile(_agent_path(name, "run.py"))
        or os.path.isfile(_agent_path(name, "main.py"))
    )


def list_agents():
    """Return installed agent names from the sandboxed agents directory."""
    try:
        os.makedirs(INSTALLED_AGENTS_DIR, exist_ok=True)
        names = []
        for entry in os.listdir(INSTALLED_AGENTS_DIR):
            if _is_installed(entry):
                names.append(entry)
        return sorted(names)
    except Exception:
        return []


def load_manifest(name: str):
    """Return a manifest dict, or a minimal stub if none exists."""
    mpath = _agent_path(name, "manifest.json")
    if os.path.isfile(mpath):
        try:
            with open(mpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("name", name)
                return data
        except Exception:
            pass
    # infer a minimal manifest from folder contents
    entrypoint = None
    for candidate in ("run.py", "main.py"):
        if os.path.isfile(_agent_path(name, candidate)):
            entrypoint = candidate
            break
    return {
        "name": name,
        "description": "Installed local agent.",
        "entrypoint": entrypoint,
        "installed_dir": _agent_dir(name),
    }


def run_agent(name: str, context=None):
    """Execute an installed agent's entrypoint script with context as JSON on stdin.

    Returns a dict with execution status, stdout/stderr, and timing.
    """
    if not _is_installed(name):
        raise FileNotFoundError(f"Agent not found: {name}")
    manifest = load_manifest(name)
    entrypoint = manifest.get("entrypoint")
    if not entrypoint:
        raise FileNotFoundError(f"Agent '{name}' has no runnable entrypoint.")
    script = _agent_path(name, entrypoint)
    if not os.path.isfile(script):
        raise FileNotFoundError(f"Agent entrypoint missing: {script}")
    payload = json.dumps(context or {}, ensure_ascii=False).encode("utf-8")
    t0 = time.time()
    try:
        proc = subprocess.Popen(
            [sys.executable, script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=_agent_dir(name),
        )
        stdout, _ = proc.communicate(input=payload, timeout=180)
        dt = round(time.time() - t0, 2)
        text = stdout.decode("utf-8", errors="replace").strip()
        if proc.returncode != 0:
            return {
                "status": "error",
                "agent": name,
                "code": proc.returncode,
                "output": text,
                "secs": dt,
            }
        try:
            parsed = json.loads(text)
            parsed.setdefault("status", "ok")
            parsed.setdefault("agent", name)
            parsed.setdefault("secs", dt)
            return parsed
        except json.JSONDecodeError:
            return {
                "status": "ok",
                "agent": name,
                "output": text,
                "secs": dt,
            }
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "agent": name,
            "output": "Agent exceeded the execution timeout.",
            "secs": 180,
        }
    except Exception as exc:
        return {
            "status": "error",
            "agent": name,
            "output": str(exc),
            "secs": round(time.time() - t0, 2),
        }
