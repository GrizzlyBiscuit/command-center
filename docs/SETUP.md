# Setup

## Prerequisites

- Windows 10/11
- Python 3.11+ installed at `C:\Python314` or in PATH
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

Note: `.env` is for secrets only. Non-secret settings belong in config files.

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
- Or place a shortcut to `pythonw.exe backend\app.py` in the Startup folder with `WindowStyle=7`
- The full `launcher/synth_launcher.py` desktop window is the music/video renderer used by **Play on > Command Center PC**. Keep that window open or minimized when controlling playback from a phone; running Flask alone cannot produce PC media playback.
- Configure the music and video folders separately from their **Settings** views. Only the host can choose folders or start manual scans; LAN/private-VPN clients can browse, stream, and control playback.
- Direct video playback supports MP4 and WebM in this first version. Codec support still depends on the destination browser, and Command Center does not transcode files.

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
