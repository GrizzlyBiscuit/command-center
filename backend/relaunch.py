"""Zero-downtime-ish hub relauncher, spawned by /app/restart.

Strategy (Windows, single port 5050 — no front proxy):
  1. Boot the NEW hub on a TEMP port (5051) so it can fully import + warm up
     while the OLD hub keeps serving 5050.
  2. Wait until the temp hub answers (it's 100% ready).
  3. NOW kill the OLD pid (5050 frees).
  4. Spawn the FINAL hub on 5050, wait until it answers, then kill the temp one.

The dead window is just the final bind (~sub-second), not a cold import.
The browser refresh flow already polls / and only navigates on 200, so the
user sees at most a brief pause — not a "connection dropped" caution.
"""
import os, socket, subprocess, sys, time

PORT = 5050
TMP = 5051
PYW = r"C:\Python314\pythonw.exe"
APP = r"C:\web\app.py"
CREATE_NO_WINDOW = 0x08000000
OLD_PID = None
if len(sys.argv) > 1:
    try:
        OLD_PID = int(sys.argv[1])
    except Exception:
        OLD_PID = None


def port_open(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex(("127.0.0.1", port)) == 0
    except Exception:
        return False


def wait_open(port, max_s=20):
    for _ in range(int(max_s / 0.25)):
        if port_open(port):
            return True
        time.sleep(0.25)
    return port_open(port)


def spawn(port):
    env = dict(os.environ)
    env["FLASK_PORT"] = str(port)
    return subprocess.Popen(
        [PYW, APP], creationflags=CREATE_NO_WINDOW,
        close_fds=True, cwd=r"C:\web", env=env)


# 1) warm up NEW on temp port (old hub still serving 5050)
new_tmp = spawn(TMP)
# 2) wait until the new hub is fully ready
if not wait_open(TMP, 20):
    # temp hub failed to come up — bail: leave the old one running
    try:
        if new_tmp:
            new_tmp.kill()
    except Exception:
        pass
    sys.exit(1)
# 3) now safe to kill the OLD hub (5050 frees)
if OLD_PID:
    try:
        os.kill(OLD_PID, 9)
    except Exception:
        pass
    # give the OS a moment to release the socket
    time.sleep(0.4)
# 4) spawn FINAL on 5050, wait, then retire the temp hub
final = spawn(PORT)
if wait_open(PORT, 20):
    # success — kill the temp 5051 hub
    try:
        if new_tmp:
            new_tmp.kill()
    except Exception:
        pass
else:
    # final failed; if temp still up, at least the box isn't dark
    pass
sys.exit(0)
