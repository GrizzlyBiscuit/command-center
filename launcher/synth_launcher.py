"""
synth_launcher.py — Command Center entry point (chromeless + lifecycle).

Single entry point:
  1. Starts the Flask hub (http://127.0.0.1:5050) if it isn't already up.
  2. Opens the chromeless WebView2 window (no URL bar / OS chrome).
  3. When the window closes (or Ctrl+C), kills EVERYTHING it started:
     the hub process AND any running Discord relay, so nothing lingers.

Run with the hermes venv python (pywebview lives there, cffi matches):
  <hermes venv>/python.exe synth_launcher.py
"""
import os
import sys
import time
import signal
import subprocess
import http.cookiejar
import urllib.request
import threading
import ctypes

# Windows screen metrics (launcher only runs on Windows)
try:
    _user32 = ctypes.windll.user32
    _user32.SetProcessDPIAware()
    def GetSystemMetrics(n):
        return int(_user32.GetSystemMetrics(n))
except Exception:
    def GetSystemMetrics(n):
        return {0: 1920, 1: 1080}.get(n, 0)

import webview

HUB = os.environ.get("HUB_URL", "http://127.0.0.1:5050")
HUB_PORT = int(os.environ.get("FLASK_PORT", "5050"))
HUB_SCRIPT = r"C:\web\app.py"
HUB_PY = r"C:\Python314\python.exe"
RELAY_SCRIPT = r"C:\Users\mattz\Desktop\Ai\discord_relay.py"
TITLE = "Command Center"

# PIDs we spawned, so we can clean them up on exit.
_spawned = {"hub": None}
_shutting_down = False


def log(msg):
    print(f"[launcher] {msg}", flush=True)


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
_EnumWindows = ctypes.windll.user32.EnumWindows
_EnumWindows.restype = ctypes.c_bool
_EnumWindows.argtypes = [
    ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p),
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

def minimize_window_for_pid(pid):
    """Minimize any top-level window owned by the given PID (e.g. a hub
    console spawned with python.exe). Runs after a short delay so the
    window exists by the time we look for it."""
    try:
        time.sleep(2.5)
        _TargetPid[0] = pid
        _EnumWindows(_enum_minimize, 0)
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
    return r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

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
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def start_hub():
    """Start the Flask hub detached with NO console window; record its PID.
    No-op if already up."""
    if wait_for_server(HUB, timeout=2):
        log("hub already up")
        return
    env = dict(os.environ)
    env["FLASK_PORT"] = str(HUB_PORT)
    # Use pythonw + CREATE_NO_WINDOW so the hub never pops a console window.
    hub_py = HUB_PY.replace("python.exe", "pythonw.exe")
    if not os.path.exists(hub_py):
        hub_py = HUB_PY
    proc = subprocess.Popen(
        [hub_py, HUB_SCRIPT],
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
        stdout=open(r"C:\Users\mattz\Desktop\Ai\flask5050.txt", "a"),
        stderr=subprocess.STDOUT,
    )
    _spawned["hub"] = proc.pid
    log(f"hub started pid={proc.pid}")
    wait_for_server(HUB, timeout=15)
    # Tuck the hub's console window away (it spawns via python.exe, which
    # can pop a visible console). Logs still stream to flask5050.txt.
    threading.Thread(target=minimize_window_for_pid, args=(proc.pid,), daemon=True).start()


import msvcrt  # Windows file locking

LOCK_FILE = r"C:\Users\mattz\Desktop\Ai\HubLauncher\.command_center.lock"


def already_running():
    """Return (is_running, lock_handle).

    Single-instance guard via an exclusive file lock. CRITICAL: a stale lock
    file left by a crashed launcher must NOT block new launches. So on a
    failed lock we read the PID recorded in the file; if that PID is NOT alive
    we steal the lock (overwrite + relock). Only treat it as 'running' if the
    recorded PID is actually alive.
    """
    try:
        # Try to grab an exclusive lock on a fresh attempt.
        f = open(LOCK_FILE, "w")
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        f.write(str(os.getpid()))
        f.flush()
        return False, f
    except (OSError, IOError):
        pass
    # Lock failed -> someone holds it. Check if that holder is still alive.
    try:
        if os.path.exists(LOCK_FILE):
            with open(LOCK_FILE, "r") as fh:
                pid_text = fh.read().strip()
            if pid_text.isdigit():
                pid = int(pid_text)
                # If the recorded PID is dead, the lock is stale -> steal it.
                try:
                    os.kill(pid, 0)  # raises if not alive (Windows: still works for existance)
                except OSError:
                    # dead -> overwrite and relock
                    try:
                        f = open(LOCK_FILE, "w")
                        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                        f.write(str(os.getpid()))
                        f.flush()
                        return False, f
                    except (OSError, IOError):
                        return True, None
        return True, None
    except Exception:
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
    log("shutting down — killing hub + relays")
    if _spawned.get("hub"):
        kill_process_tree(_spawned["hub"])
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

    def choose_music_folder(self):
        """Open the native folder picker for the local Music settings page."""
        w = self._holder.get("w")
        if not w:
            return None
        try:
            selected = w.create_file_dialog(webview.FOLDER_DIALOG, allow_multiple=False)
        except TypeError:
            # Older pywebview releases do not expose allow_multiple here.
            try:
                selected = w.create_file_dialog(webview.FOLDER_DIALOG)
            except Exception as exc:
                log(f"music folder picker failed: {exc}")
                return None
        except Exception as exc:
            log(f"music folder picker failed: {exc}")
            return None
        if not selected:
            return None
        folder = selected if isinstance(selected, str) else selected[0]
        folder = os.path.abspath(os.path.expanduser(folder))
        return folder if os.path.isdir(folder) else None

    def choose_video_folder(self):
        """Open the native folder picker for the local Video settings page."""
        w = self._holder.get("w")
        if not w:
            return None
        try:
            selected = w.create_file_dialog(webview.FOLDER_DIALOG, allow_multiple=False)
        except TypeError:
            # Older pywebview releases do not expose allow_multiple here.
            try:
                selected = w.create_file_dialog(webview.FOLDER_DIALOG)
            except Exception as exc:
                log(f"video folder picker failed: {exc}")
                return None
        except Exception as exc:
            log(f"video folder picker failed: {exc}")
            return None
        if not selected:
            return None
        folder = selected if isinstance(selected, str) else selected[0]
        folder = os.path.abspath(os.path.expanduser(folder))
        return folder if os.path.isdir(folder) else None


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
    # Single-instance guard via exclusive file lock.
    running, lock_fh = already_running()
    if running:
        log("another instance is already running — exiting")
        return
    # keep the lock handle referenced for the process lifetime
    globals()['_lock'] = lock_fh

    # Clean up any relays left from a previous crashed session first.
    kill_all_relays()

    start_hub()

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
