"""
synth_launcher.py — Command Center entry point (chromeless + lifecycle).

Single entry point:
  1. Starts the Flask hub (http://127.0.0.1:5050) if it isn't already up.
  2. Opens the chromeless WebView2 window (no URL bar / OS chrome).
  3. When the window closes (or Ctrl+C), kills EVERYTHING it started:
     the hub process AND any running Discord relay, so nothing lingers.

Run from a repository checkout with its virtual environment:
  .venv\\Scripts\\pythonw.exe launcher\\synth_launcher.py

The original Hermes/C:\\web layout remains available as a fallback.
"""
import os
import sys
import time
import signal
import subprocess
import json
import math
import secrets
import http.cookiejar
import urllib.request
import threading
import ctypes
from pathlib import Path
import psutil

LAUNCHER_DIR = Path(__file__).resolve().parent
REPO_ROOT = LAUNCHER_DIR.parent


def _load_repo_environment(repo_root):
    """Load checkout overrides when python-dotenv is available.

    The original standalone Hermes launcher did not require python-dotenv, so
    absence of this optional convenience must not prevent it from starting.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return False
    return bool(load_dotenv(Path(repo_root) / ".env", override=False))


_load_repo_environment(REPO_ROOT)

# Windows screen metrics (launcher only runs on Windows)
try:
    _user32 = ctypes.windll.user32
    _user32.SetProcessDPIAware()
    def GetSystemMetrics(n):
        return int(_user32.GetSystemMetrics(n))
except Exception:
    def GetSystemMetrics(n):
        return {0: 1920, 1: 1080}.get(n, 0)

try:
    import webview
except ImportError:  # Allows path helpers to be tested before desktop extras are installed.
    webview = None

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DETACHED_PROCESS = getattr(subprocess, "DETACHED_PROCESS", 0)
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

LEGACY_HUB_SCRIPT = Path(r"C:\web\app.py")
LEGACY_HUB_PYTHON = Path(r"C:\Python314\python.exe")


def _configured_path(environ, *names):
    """Return the first non-empty path override in *names*."""
    for name in names:
        value = environ.get(name, "").strip()
        if value:
            return Path(os.path.expandvars(os.path.expanduser(value)))
    return None


def resolve_hub_script(environ=None, repo_root=None, legacy_path=None):
    """Resolve app.py without tying a checkout to one Windows profile."""
    environ = os.environ if environ is None else environ
    override = _configured_path(environ, "CC_HUB_SCRIPT", "HUB_SCRIPT")
    if override is not None:
        return override

    repo_candidate = Path(repo_root or REPO_ROOT) / "backend" / "app.py"
    if repo_candidate.is_file():
        return repo_candidate

    legacy_candidate = Path(legacy_path or LEGACY_HUB_SCRIPT)
    if legacy_candidate.is_file():
        return legacy_candidate
    return repo_candidate


def resolve_hub_python(environ=None, repo_root=None, legacy_path=None, current_python=None):
    """Prefer this checkout's venv, retaining the legacy install as a fallback."""
    environ = os.environ if environ is None else environ
    override = _configured_path(environ, "CC_HUB_PYTHON", "HUB_PYTHON")
    if override is not None:
        return override

    repo_candidate = Path(repo_root or REPO_ROOT) / ".venv" / "Scripts" / "python.exe"
    if repo_candidate.is_file():
        return repo_candidate

    legacy_candidate = Path(legacy_path or LEGACY_HUB_PYTHON)
    if legacy_candidate.is_file():
        return legacy_candidate
    return Path(current_python or sys.executable)


def resolve_runtime_paths(environ=None, home=None):
    """Return per-user launcher runtime, log, and lock paths."""
    environ = os.environ if environ is None else environ
    runtime_dir = _configured_path(environ, "CC_LAUNCHER_RUNTIME_DIR")
    if runtime_dir is None:
        local_app_data = environ.get("LOCALAPPDATA", "").strip()
        base = Path(local_app_data) if local_app_data else Path(home or Path.home()) / "AppData" / "Local"
        runtime_dir = base / "CommandCenter" / "launcher"

    log_file = _configured_path(environ, "CC_HUB_LOG_FILE") or runtime_dir / "hub.log"
    lock_file = _configured_path(environ, "CC_LAUNCHER_LOCK_FILE") or runtime_dir / "command-center.lock"
    return runtime_dir, log_file, lock_file


def resolve_hub_pid_file(environ=None, runtime_dir=None):
    """Resolve the shared launcher/backend hub ownership record."""
    environ = os.environ if environ is None else environ
    runtime_dir = Path(runtime_dir or RUNTIME_DIR)
    return _configured_path(environ, "CC_HUB_PID_FILE") or runtime_dir / "hub.pid"


def resolve_launcher_lifetime_file(environ=None, runtime_dir=None):
    """Resolve the marker used to cancel relaunch when this window closes."""
    environ = os.environ if environ is None else environ
    runtime_dir = Path(runtime_dir or RUNTIME_DIR)
    return (
        _configured_path(environ, "CC_LAUNCHER_LIFETIME_FILE")
        or runtime_dir / "launcher.alive"
    )


def resolve_hub_working_directory(hub_script=None, repo_root=None):
    """Use the repo root for a checkout and the script folder for legacy deployments."""
    script = Path(hub_script or HUB_SCRIPT)
    root = Path(repo_root or REPO_ROOT)
    if script == root / "backend" / "app.py":
        return root
    return script.parent


HUB_PORT = int(os.environ.get("FLASK_PORT", "5050"))
HUB = os.environ.get("HUB_URL", "").strip() or f"http://127.0.0.1:{HUB_PORT}"
HUB_READINESS_URL = f"{HUB.rstrip('/')}/api/version"
HUB_SCRIPT = resolve_hub_script()
HUB_PY = resolve_hub_python()
RUNTIME_DIR, HUB_LOG_FILE, LOCK_FILE = resolve_runtime_paths()
HUB_PID_FILE = resolve_hub_pid_file()
LAUNCHER_LIFETIME_FILE = resolve_launcher_lifetime_file()
LAUNCHER_INSTANCE_TOKEN = secrets.token_hex(32)
TITLE = "Command Center"

PROCESS_CREATE_TIME_TOLERANCE_SECONDS = 0.5

# PIDs we spawned, so we can clean them up on exit.
_spawned = {"hub": None}
_shutting_down = False


def log(msg):
    print(f"[launcher] {msg}", flush=True)


def show_error(message):
    """Log an actionable startup error and show it when running via pythonw."""
    log(message)
    try:
        ctypes.windll.user32.MessageBoxW(0, message, "Command Center", 0x10)
    except Exception:
        pass


def minimize_self_console():
    """Minimize THIS launcher's own console window shortly after launch.
    No-op when launched via pythonw (no console)."""
    try:
        time.sleep(2.5)
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE = 6
    except Exception as e:
        log(f"minimize console skipped: {e}")


# ---- minimize a spawned child's console window by PID ----
_SW_MINIMIZE = 6
_EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
_EnumWindows = ctypes.windll.user32.EnumWindows
_EnumWindows.restype = ctypes.c_bool
_EnumWindows.argtypes = [
    _EnumWindowsProc,
    ctypes.c_void_p,
]
_GWT = ctypes.windll.user32.GetWindowThreadProcessId
_GWT.restype = ctypes.c_uint
_GWT.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint)]
_IsVisible = ctypes.windll.user32.IsWindowVisible
_IsVisible.restype = ctypes.c_bool
_IsVisible.argtypes = [ctypes.c_void_p]
_Show = ctypes.windll.user32.ShowWindow
_Show.argtypes = [ctypes.c_void_p, ctypes.c_int]

_TargetPid = [0]

def _enum_minimize(hwnd, _):
    pid = ctypes.c_uint()
    _GWT(hwnd, ctypes.byref(pid))
    if pid.value == _TargetPid[0] and _IsVisible(hwnd):
        _Show(hwnd, _SW_MINIMIZE)
    return True


_EnumMinimizeCallback = _EnumWindowsProc(_enum_minimize)

def minimize_window_for_pid(pid):
    """Minimize any top-level window owned by the given PID (e.g. a hub
    console spawned with python.exe). Runs after a short delay so the
    window exists by the time we look for it."""
    try:
        time.sleep(2.5)
        _TargetPid[0] = pid
        _EnumWindows(_EnumMinimizeCallback, 0)
    except Exception as e:
        log(f"minimize pid {pid} skipped: {e}")


def minimize_cc_consoles():
    """Catch-all: minimize any console window (class ConsoleWindowClass) that
    appears during launch. We enumerate ALL top-level windows and minimize the
    console-class ones — Get-Process.MainWindowHandle is unreliable for consoles
    (often 0), so EnumWindows+GetClassName is the robust path. Broad by design:
    the user is fine re-raising a terminal they were already using."""
    try:
        time.sleep(3.0)
        ps = _ps_executable()
        script = (
            "Add-Type @'\n"
            "using System; using System.Runtime.InteropServices; using System.Text;\n"
            "public class EW {\n"
            "  public delegate bool D(IntPtr h, IntPtr p);\n"
            "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(D d, IntPtr p);\n"
            "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);\n"
            "  [DllImport(\"user32.dll\")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);\n"
            "  public static bool CB(IntPtr h, IntPtr p) {\n"
            "    var sb = new StringBuilder(256); GetClassName(h, sb, 256);\n"
            "    if (sb.ToString() == \"ConsoleWindowClass\") ShowWindow(h, 6);\n"
            "    return true;\n"
            "  }\n"
            "}\n"
            "'@\n"
            "[EW]::EnumWindows([EW+D]{param($h,$p) [EW]::CB($h,$p)}, [IntPtr]::Zero) | Out-Null\n"
        )
        subprocess.run(
            [ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            **_ps_kwargs(),
        )
    except Exception as e:
        log(f"minimize cc consoles skipped: {e}")


def _ps_executable():
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    candidate = system_root / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    return str(candidate) if candidate.is_file() else "powershell.exe"

def _ps_kwargs():
    return dict(
        capture_output=True,
        text=True,
        timeout=20,
        creationflags=CREATE_NO_WINDOW,
    )


def wait_for_server(url, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                pass
            return True
        except Exception:
            time.sleep(0.5)
    return False


def _resolved_script(script):
    return str(Path(script).expanduser().resolve())


def _atomic_write_hub_record(record, path=None):
    """Atomically publish a hub identity record shared with backend/relaunch."""
    path = Path(path or HUB_PID_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(record, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _atomic_write_lifetime_marker(path=None, token=None):
    """Publish this launcher's exact token before any owned hub is spawned."""
    path = Path(path or LAUNCHER_LIFETIME_FILE)
    token = LAUNCHER_INSTANCE_TOKEN if token is None else str(token)
    if not token:
        raise ValueError("launcher instance token must not be empty")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(token)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _remove_lifetime_marker_if_owned(path=None, token=None):
    """Invalidate only this launcher instance's lifetime marker."""
    path = Path(path or LAUNCHER_LIFETIME_FILE)
    token = LAUNCHER_INSTANCE_TOKEN if token is None else str(token)
    try:
        if path.read_text(encoding="utf-8") != token:
            return False
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except (OSError, UnicodeError) as exc:
        log(f"lifetime marker could not be removed safely: {exc}")
        return False


def _write_hub_process_record(pid, script=None, path=None):
    """Capture enough process identity to reject stale or reused PIDs later."""
    process = psutil.Process(int(pid))
    record = {
        "pid": int(pid),
        "create_time": float(process.create_time()),
        "script": _resolved_script(script or HUB_SCRIPT),
    }
    _atomic_write_hub_record(record, path=path)
    return record


def _read_hub_record(path=None):
    path = Path(path or HUB_PID_FILE)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None

    pid = payload.get("pid")
    create_time = payload.get("create_time")
    script = payload.get("script")
    if type(pid) is not int or pid <= 0:
        return None
    if isinstance(create_time, bool) or not isinstance(create_time, (int, float)):
        return None
    create_time = float(create_time)
    if not math.isfinite(create_time) or create_time <= 0:
        return None
    if not isinstance(script, str) or not script.strip() or not Path(script).is_absolute():
        return None
    return {"pid": pid, "create_time": create_time, "script": script}


def _same_path(left, right):
    try:
        return os.path.normcase(_resolved_script(left)) == os.path.normcase(_resolved_script(right))
    except (OSError, TypeError, ValueError):
        return False


def _same_hub_record(left, right):
    if not left or not right:
        return False
    return (
        left.get("pid") == right.get("pid")
        and abs(float(left.get("create_time")) - float(right.get("create_time")))
        <= PROCESS_CREATE_TIME_TOLERANCE_SECONDS
        and _same_path(left.get("script"), right.get("script"))
    )


def _validated_recorded_hub(path=None, expected_script=None):
    """Return (record, process) only when PID, birth time, and script all match."""
    path = Path(path or HUB_PID_FILE)
    expected_script = expected_script or HUB_SCRIPT
    record = _read_hub_record(path)
    if not record or not _same_path(record["script"], expected_script):
        return None
    try:
        process = psutil.Process(record["pid"])
        if (
            abs(float(process.create_time()) - record["create_time"])
            > PROCESS_CREATE_TIME_TOLERANCE_SECONDS
        ):
            return None
        if not any(_same_path(argument.strip('"'), record["script"]) for argument in process.cmdline()):
            return None
    except (psutil.Error, OSError, TypeError, ValueError):
        return None
    return record, process


def _clear_hub_record_if_current(record, path=None):
    """Remove only the same identity record that was just acted upon."""
    path = Path(path or HUB_PID_FILE)
    if not _same_hub_record(_read_hub_record(path), record):
        return False
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def _terminate_owned_hub(expected_record=None):
    """Terminate the current validated process in this launcher's hub lineage."""
    if not _spawned.get("hub"):
        return False
    validated = _validated_recorded_hub()
    if not validated:
        log("hub ownership record is stale or invalid; refusing to terminate its PID")
        _spawned["hub"] = None
        return False
    record, _process = validated
    if expected_record is not None and not _same_hub_record(record, expected_record):
        log("hub ownership changed during startup; refusing to terminate the replacement")
        _spawned["hub"] = None
        return False
    kill_process_tree(record["pid"])
    _clear_hub_record_if_current(record)
    _spawned["hub"] = None
    return True


def _terminate_spawned_process(process):
    """Stop the exact Popen when ownership metadata could not be published."""
    try:
        process.terminate()
    except Exception:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
            process.wait(timeout=5)
        except Exception:
            pass


def start_hub():
    """Start the Flask hub detached with NO console window; record its PID.
    No-op if already up."""
    if wait_for_server(HUB_READINESS_URL, timeout=2):
        log("hub already up")
        return
    env = dict(os.environ)
    env["FLASK_PORT"] = str(HUB_PORT)
    env["CC_HUB_PID_FILE"] = _resolved_script(HUB_PID_FILE)
    env["CC_LAUNCHER_LIFETIME_FILE"] = _resolved_script(LAUNCHER_LIFETIME_FILE)
    env["CC_LAUNCHER_INSTANCE_TOKEN"] = LAUNCHER_INSTANCE_TOKEN
    if not HUB_SCRIPT.is_file():
        raise FileNotFoundError(
            f"Command Center backend was not found at {HUB_SCRIPT}. "
            "Set CC_HUB_SCRIPT to its app.py path."
        )
    if not HUB_PY.is_file():
        raise FileNotFoundError(
            f"Command Center Python was not found at {HUB_PY}. "
            "Create .venv or set CC_HUB_PYTHON."
        )

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    HUB_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Use pythonw + CREATE_NO_WINDOW so the hub never pops a console window.
    hub_py = HUB_PY.with_name("pythonw.exe") if HUB_PY.name.lower() == "python.exe" else HUB_PY
    if not hub_py.is_file():
        hub_py = HUB_PY
    _atomic_write_lifetime_marker()
    with HUB_LOG_FILE.open("a", encoding="utf-8") as log_handle:
        proc = subprocess.Popen(
            [str(hub_py), str(HUB_SCRIPT)],
            cwd=str(resolve_hub_working_directory()),
            env=env,
            creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
        )
    _spawned["hub"] = proc.pid
    try:
        spawned_record = _write_hub_process_record(proc.pid)
    except Exception:
        _terminate_spawned_process(proc)
        _spawned["hub"] = None
        raise
    log(f"hub started pid={proc.pid}")
    if not wait_for_server(HUB_READINESS_URL, timeout=15):
        _terminate_owned_hub(expected_record=spawned_record)
        raise RuntimeError(
            f"Command Center hub did not become ready at {HUB_READINESS_URL}. "
            f"See {HUB_LOG_FILE} for startup details."
        )
    # Tuck the hub's console window away (it spawns via python.exe, which
    # can pop a visible console). Logs still stream to HUB_LOG_FILE.
    threading.Thread(target=minimize_window_for_pid, args=(proc.pid,), daemon=True).start()


import msvcrt  # Windows file locking


def already_running():
    """Return (is_running, lock_handle).

    The operating-system lock, rather than the existence of the file, is the
    guard. A stale file from a crash is therefore harmless because Windows
    releases the lock when the owning process exits.
    """
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        f = LOCK_FILE.open("a+b")
        if f.seek(0, os.SEEK_END) == 0:
            f.write(b"\0")
            f.flush()
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        f.seek(0)
        f.truncate()
        f.write(str(os.getpid()).encode("ascii"))
        f.flush()
        return False, f
    except (OSError, IOError):
        try:
            f.close()
        except (NameError, OSError):
            pass
        return True, None



def kill_process_tree(pid):
    """Kill a PID and its children on Windows via PowerShell."""
    if not pid:
        return
    try:
        ps = (
            f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue;"
            f"Get-CimInstance Win32_Process -Filter \"ParentProcessId={pid}\" "
            f"-ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
        )
        subprocess.run(
            [_ps_executable(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            **_ps_kwargs(),
        )
    except Exception as e:
        log(f"kill tree {pid} failed: {e}")


def kill_all_relays():
    """Kill every running discord_relay.py process."""
    try:
        ps = (
            "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" "
            "-ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*discord_relay*' } "
            "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(
            [_ps_executable(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            **_ps_kwargs(),
        )
        log("relays killed")
    except Exception as e:
        log(f"kill relays failed: {e}")


def shutdown():
    global _shutting_down
    if _shutting_down:
        return
    _shutting_down = True
    _remove_lifetime_marker_if_owned()
    log("shutting down - stopping owned hub + relays")
    if _spawned.get("hub"):
        _terminate_owned_hub()
    kill_all_relays()


class Api:
    """JS-callable window controls (frameless window)."""
    def __init__(self, holder):
        self._holder = holder
        self._maximized = False
        self._default_w = 1180
        self._default_h = 760

    def minimize(self):
        w = self._holder.get("w")
        if w:
            w.minimize()

    def toggle_max(self):
        w = self._holder.get("w")
        if w:
            # toggle_fullscreen is the reliable path for frameless windows
            try:
                w.toggle_fullscreen()
                self._maximized = not self._maximized
                return
            except Exception:
                pass
            # fallback: manual resize to work area
            if self._maximized:
                w.resize(self._default_w, self._default_h)
                w.move(
                    max(0, (GetSystemMetrics(0) - self._default_w) // 2),
                    max(0, (GetSystemMetrics(1) - self._default_h) // 2),
                )
                self._maximized = False
            else:
                w.resize(GetSystemMetrics(0), GetSystemMetrics(1))
                w.move(0, 0)
                self._maximized = True

    def close(self):
        w = self._holder.get("w")
        if w:
            w.destroy()

    def start_drag(self):
        w = self._holder.get("w")
        if w:
            w.start_drag()

    def _choose_media_folder(self, media_kind):
        """Open a native folder picker across pywebview 5 and 6 APIs."""
        w = self._holder.get("w")
        if not w:
            return None
        if webview is None:
            log(f"{media_kind} folder picker unavailable: install pywebview")
            return None

        file_dialog = getattr(webview, "FileDialog", None)
        dialog_type = getattr(file_dialog, "FOLDER", None)
        if dialog_type is None:
            dialog_type = getattr(webview, "FOLDER_DIALOG", None)
        if dialog_type is None:
            log(f"{media_kind} folder picker unavailable: unsupported pywebview version")
            return None

        try:
            selected = w.create_file_dialog(dialog_type, allow_multiple=False)
        except TypeError:
            # Older pywebview releases do not expose allow_multiple here.
            try:
                selected = w.create_file_dialog(dialog_type)
            except Exception as exc:
                log(f"{media_kind} folder picker failed: {exc}")
                return None
        except Exception as exc:
            log(f"{media_kind} folder picker failed: {exc}")
            return None
        if not selected:
            return None
        folder = selected if isinstance(selected, str) else selected[0]
        folder = os.path.abspath(os.path.expanduser(folder))
        return folder if os.path.isdir(folder) else None

    def choose_music_folder(self):
        """Open the native folder picker for the local Music settings page."""
        return self._choose_media_folder("music")

    def choose_video_folder(self):
        """Open the native folder picker for the local Video settings page."""
        return self._choose_media_folder("video")


def boot_relay_on_start():
    """On login, bring the bridge up automatically: boot Ollama if down and
    start the Discord relay via the hub's own API (with CSRF token)."""
    try:
        import re
        import urllib.parse
        cj = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        html = op.open(HUB + "/bot-control", timeout=15).read().decode()
        m = re.search(r'const csrf = "([^"]+)"', html)
        if not m:
            log("boot_relay: no csrf token found")
            return
        tok = m.group(1)
        data = urllib.parse.urlencode({"csrf_token": tok}).encode()
        req = urllib.request.Request(HUB + "/bot/start", data=data, method="POST")
        r = op.open(req, timeout=30)
        log("boot_relay: " + r.read().decode().strip()[:120])
    except Exception as e:
        log(f"boot_relay failed: {e}")


def main():
    if webview is None:
        message = (
            "The desktop launcher requires pywebview. Install this repository's "
            "requirements with: .venv\\Scripts\\python.exe -m pip install -r requirements.txt"
        )
        show_error(message)
        raise RuntimeError(message)

    # Single-instance guard via exclusive file lock.
    running, lock_fh = already_running()
    if running:
        log("another instance is already running — exiting")
        return
    # keep the lock handle referenced for the process lifetime
    globals()['_lock'] = lock_fh

    # Clean up any relays left from a previous crashed session first.
    kill_all_relays()

    try:
        start_hub()
    except Exception as exc:
        message = f"Command Center startup failed: {exc}"
        show_error(message)
        shutdown()
        raise RuntimeError(message) from exc

    # Bring the bridge (Ollama + Discord relay) up automatically on login.
    boot_relay_on_start()

    holder = {}
    api = Api(holder)
    window = webview.create_window(
        TITLE,
        url=HUB,
        frameless=True,
        easy_drag=False,
        width=1180,
        height=760,
        min_size=(820, 560),
        background_color="#0a0118",
        js_api=api,
        fullscreen=True,
    )
    holder["w"] = window

    # When the window is destroyed, tear down everything.
    def _on_close():
        shutdown()
        os._exit(0)

    window.events.closed += _on_close

    # Tuck any CC console windows away shortly after launch.
    threading.Thread(target=minimize_self_console, daemon=True).start()
    threading.Thread(target=minimize_cc_consoles, daemon=True).start()

    try:
        webview.start(debug=False, gui="edgechromium")
    except KeyboardInterrupt:
        pass
    finally:
        shutdown()


if __name__ == "__main__":
    main()
