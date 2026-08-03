"""Zero-downtime-ish hub relauncher, spawned by /app/restart.

The helper warms a replacement on a temporary port, stops the old process,
then starts the final replacement on the configured hub port. Runtime paths
are supplied by the running app so both repository and legacy layouts work.
"""

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import psutil


CREATE_NO_WINDOW = 0x08000000 if sys.platform.startswith('win') else 0


def windowless_python(executable, *, platform=None, is_file=None):
    """Prefer pythonw beside the active Windows interpreter when available."""
    platform = sys.platform if platform is None else platform
    is_file = os.path.isfile if is_file is None else is_file
    executable = str(executable)
    if not platform.startswith('win'):
        return executable
    path = Path(executable)
    if path.name.lower() != 'python.exe':
        return executable
    pythonw = path.with_name('pythonw.exe')
    return str(pythonw) if is_file(str(pythonw)) else executable


def build_relaunch_command(*, executable, helper_path, old_pid, app_path, cwd, port):
    """Build the self-contained handoff from the running hub to this helper."""
    python = windowless_python(executable)
    return [
        python,
        str(helper_path),
        str(old_pid),
        '--python', python,
        '--app', str(app_path),
        '--cwd', str(cwd),
        '--port', str(port),
    ]


def port_open(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            connection.settimeout(0.5)
            return connection.connect_ex(('127.0.0.1', port)) == 0
    except Exception:
        return False


def wait_open(port, max_s=20, keep_running=None):
    def should_continue():
        try:
            return keep_running is None or bool(keep_running())
        except Exception:
            return False

    for _ in range(int(max_s / 0.25)):
        if not should_continue():
            return False
        if port_open(port):
            return should_continue()
        time.sleep(0.25)
    return should_continue() and port_open(port) and should_continue()


def spawn_hub(python, app, cwd, port):
    env = dict(os.environ)
    env['FLASK_PORT'] = str(port)
    return subprocess.Popen(
        [str(python), str(app)],
        creationflags=CREATE_NO_WINDOW,
        close_fds=True,
        cwd=str(cwd),
        env=env,
    )


def write_hub_ownership(pid_file, process, app, *, process_factory=None):
    """Atomically record ownership of the final hub; never disrupt restart."""
    pid_file = str(pid_file or '').strip()
    if not pid_file:
        return False
    process_factory = psutil.Process if process_factory is None else process_factory
    temp_path = None
    try:
        target = Path(os.path.expandvars(os.path.expanduser(pid_file)))
        target.parent.mkdir(parents=True, exist_ok=True)
        pid = int(process.pid)
        record = {
            'pid': pid,
            'create_time': float(process_factory(pid).create_time()),
            'script': str(Path(app).resolve()),
        }
        with tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            dir=str(target.parent),
            prefix=f'.{target.name}.',
            suffix='.tmp',
            delete=False,
        ) as handle:
            json.dump(record, handle, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)
        os.replace(temp_path, target)
        return True
    except Exception:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass
        return False


def clear_hub_ownership(pid_file, pid):
    """Remove ownership only when it still names this helper's final process."""
    pid_file = str(pid_file or '').strip()
    if not pid_file:
        return False
    try:
        target = Path(os.path.expandvars(os.path.expanduser(pid_file)))
        record = json.loads(target.read_text(encoding='utf-8'))
        if record.get('pid') != int(pid):
            return False
        target.unlink()
        return True
    except Exception:
        return False


def launcher_lifetime_guard(marker_file, instance_token):
    """Return a latched callback that fails when launcher ownership is lost."""
    marker_value = str(marker_file or '')
    token = str(instance_token or '')
    marker_configured = bool(marker_value.strip())
    token_configured = bool(token.strip())
    if not marker_configured and not token_configured:
        return lambda: True
    if not marker_configured or not token_configured:
        return lambda: False

    marker = Path(os.path.expandvars(os.path.expanduser(marker_value.strip())))
    canceled = False

    def keep_running():
        nonlocal canceled
        if canceled:
            return False
        try:
            canceled = marker.read_text(encoding='utf-8') != token
        except Exception:
            canceled = True
        return not canceled

    return keep_running


def kill_spawned(*processes):
    """Best-effort cleanup for processes created during this relaunch."""
    for process in processes:
        if process is None:
            continue
        try:
            process.kill()
        except Exception:
            pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Restart the running Command Center hub.')
    parser.add_argument('old_pid', nargs='?', type=int)
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--app', default=str(Path(__file__).with_name('app.py')))
    parser.add_argument('--cwd', default=os.getcwd())
    parser.add_argument('--port', type=int, default=int(os.environ.get('FLASK_PORT', '5050')))
    parser.add_argument('--temp-port', type=int)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    temp_port = args.temp_port if args.temp_port is not None else args.port + 1
    pid_file = os.environ.get('CC_HUB_PID_FILE')
    keep_running = launcher_lifetime_guard(
        os.environ.get('CC_LAUNCHER_LIFETIME_FILE'),
        os.environ.get('CC_LAUNCHER_INSTANCE_TOKEN'),
    )

    if not keep_running():
        return 1

    # Warm up a replacement while the old hub remains available.
    new_tmp = spawn_hub(args.python, args.app, args.cwd, temp_port)
    if not wait_open(temp_port, 20, keep_running=keep_running):
        kill_spawned(new_tmp)
        return 1

    # Free the configured port only after the replacement is ready.
    if not keep_running():
        kill_spawned(new_tmp)
        return 1
    if args.old_pid:
        try:
            os.kill(args.old_pid, 9)
        except Exception:
            pass
        time.sleep(0.4)

    # Start the final hub, then retire the temporary instance.
    if not keep_running():
        kill_spawned(new_tmp)
        return 1
    final = spawn_hub(args.python, args.app, args.cwd, args.port)
    write_hub_ownership(pid_file, final, args.app)
    if not keep_running():
        kill_spawned(final, new_tmp)
        clear_hub_ownership(pid_file, final.pid)
        return 1
    final_ready = wait_open(args.port, 20, keep_running=keep_running)
    if not keep_running():
        kill_spawned(final, new_tmp)
        clear_hub_ownership(pid_file, final.pid)
        return 1
    if final_ready:
        kill_spawned(new_tmp)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
