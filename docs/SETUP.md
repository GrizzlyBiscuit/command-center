# Setup

## Prerequisites

- Windows 10/11
- Python 3.11+ in PATH
- Git
- Ollama (local LLM runtime)
- Optional: Android SDK + Gradle wrapper for mobile build
- Optional: Node.js if editing frontend assets

## Clone

```
git clone https://github.com/<your-user>/command-center.git
cd command-center
```

## Install

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Environment

Copy `.env.example` to `.env` and set:

- `FLASK_PORT=5050`
- `OLLAMA_BASE_URL=http://localhost:11434/v1`
- Discord / Telegram bot tokens if using those platforms
- Any local agent keys

The launcher reads this checkout's `.env` before resolving its startup paths. Application settings still belong in their config files.

## Run

```
python backend\app.py
```

Default host: `0.0.0.0` so LAN/Tailscale devices can reach it.
Default port: `5050`.

Open:
- http://localhost:5050
- http://<this-pc-ip>:5050

## Windows minimized launcher

- Double-click `launcher/launch_cc.vbs`
- The script uses this checkout's `.venv` and `backend/app.py`, so the same checkout works from any Windows user profile or drive.
- `pywebview` is installed by `requirements.txt`; it provides the chromeless desktop window and the native Music/Video folder picker.
- The full `launcher/synth_launcher.py` desktop window is the music/video renderer used by **Play on > Command Center PC**. Keep that window open or minimized when controlling playback from a phone; running Flask alone cannot produce PC media playback.
- Configure the music and video folders separately from their **Settings** views. Only the host can choose folders or start manual scans; LAN/private-VPN clients can browse, stream, and control playback.
- Direct video playback supports MP4 and WebM in this first version. Codec support still depends on the destination browser, and Command Center does not transcode files.

Launcher state and logs default to `%LOCALAPPDATA%\CommandCenter\launcher`, outside the repository. Advanced or legacy installs can set these in the process environment or this checkout's `.env`:

- `CC_LAUNCHER_PYTHON` - full path to Python used by `launch_cc.vbs` (Windows process environment only, because it is needed before `.env` can load)
- `CC_HUB_PYTHON` - full path to Python used for the Flask process
- `CC_HUB_SCRIPT` - full path to the backend `app.py`
- `CC_LAUNCHER_RUNTIME_DIR` - launcher log/lock directory
- `CC_HUB_LOG_FILE`, `CC_LAUNCHER_LOCK_FILE`, `CC_HUB_PID_FILE`, and `CC_LAUNCHER_LIFETIME_FILE` - individual launcher-state file overrides
- `HUB_URL`, `FLASK_PORT` - local hub URL and port

The repository `.venv` and `backend/app.py` take priority. If they are unavailable, the standalone launcher still recognizes the original `C:\Python314`, `C:\web`, and Hermes locations. Environment overrides take priority over both layouts.

Ollama is resolved from `OLLAMA_EXE`, then `PATH`, then the current Windows user's standard install. The original host-specific path remains the final fallback. The desktop refresh button likewise restarts the interpreter and `backend/app.py` belonging to the currently running checkout.

## Quick verification

From the project folder:

```
.venv\Scripts\python.exe -m unittest discover -s tests\python -p "test_*.py"
```

Then double-click `launcher/launch_cc.vbs`. Open **Music > Settings** to choose a music folder and **Video > Settings** to choose a video folder. From a phone on the same LAN, open `http://<this-pc-ip>:5050`; playback can target either the phone or **Command Center PC** while the desktop launcher stays open.

## Hub routes

- `/` — home + hub dashboard
- `/changelog` — change history
- `/admin` — admin login
- `/api/hub/status` — process + relay + ollama + cron + route health
- `/api/hub/kill` — graceful shutdown
- `/api/kanban` — kanban board API
- `/arena/*` — maze, fusion, vote, pair run
- `/bot/*` — bringup, status, start, stop, killall
- `/api/fire/status` — fire watch widget data

## Mobile

See `mobile/cc-mobile-app/README.md` for Android build steps.
