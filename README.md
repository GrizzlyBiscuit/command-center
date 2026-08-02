# Command Center

Local-first, synthwave Command Center hub for Windows. It gives you a single home dashboard, a sidebar app launcher, local model controls, live monitoring, model competitions, automation tools, and optional mobile/LAN access.

## What this repo is

- `backend/` — Flask hub, API, agents, webhooks, game servers, kanban routes
- `frontend/` — templates + static assets
- `launcher/` — Windows minimized auto-launch scripts
- `mobile/` — Android WebView app source
- `docs/` — setup, development, kanban backlog

## What you need installed

1. **Windows 10/11**
2. **Python 3.11+** available as `python` or `pythonw`
3. **Git**
4. **Ollama** — local model runtime
   - Install Ollama
   - Start it with `ollama serve`
   - Pull the models you want, for example:
     - `ollama pull llama3`
     - `ollama pull codellama`
     - `ollama pull mistral`
5. **Optional: Discord bot token** if you want the Discord relay/bridge
6. **Optional: Telegram token** if you want Telegram support
7. **Optional: Node.js / Gradle / Android SDK** only if you edit frontend tooling or build the mobile APK

## Clone and install

```
git clone https://github.com/<your-user>/command-center.git
cd command-center
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env` for your machine:
- `FLASK_PORT=5050`
- `OLLAMA_BASE_URL=http://localhost:11434/v1`
- Add bot tokens if needed

## Run the hub

```
python backend\app.py
```

Then open:
- `http://localhost:5050`
- `http://<this-pc-ip>:5050` from another device on the same network

## Keyboard and controller navigation

Command Center supports full-page spatial navigation with a keyboard or a standard Gamepad API controller. Press `?` or the titlebar help button to see the shortcuts in the app.

- Keyboard: arrows or WASD move, Enter/Space selects, Escape goes back, Q/E changes panels, X opens audio, Y focuses the sidebar, and Home returns home.
- Controller: D-pad or left stick moves, A selects, B goes back, LB/RB changes panels, X opens audio, Y focuses the sidebar, View returns home, and Menu opens help.
- Snake and 2048 capture controls only after the game area is selected; Escape/B releases them. Chess squares are directly keyboard/controller selectable.

## Local music library

Open **Music > Settings** and choose the folder that contains this Command Center's music. The desktop launcher provides a native **Browse** dialog; the folder path can also be entered manually in a regular browser. Saving the folder starts a background scan.

- Music-only scanning with optional subfolders; video files and interview features are intentionally not included.
- Tracks, albums, artists, search, queue, shuffle, repeat, a persistent player dock, listening stats, Media Session controls, and visualizer integration.
- Phones and other clients that can reach Command Center over the LAN or a private VPN can browse and stream the music library. Folder configuration and manual rescans stay on the host computer.
- Settings, the artwork cache, and listening stats are stored outside the repo. Set `CC_MUSIC_DATA_DIR` to override the per-user runtime-data location.

## Run on boot, minimized

Use one of:
- `launcher/launch_cc.vbs`
- A Startup shortcut pointing to `pythonw.exe backend\app.py` with `WindowStyle=7`

## Sidebar — every panel and what it does

### Home
Landing screen. Shows the **Hub Status** cards, **Stale Runners** watcher, **Fire Watch** widget, and app version/clock.

- **Hub Status** — whether the hub process, relay pair, Ollama, and cron jobs are alive.
- **Stale Runners** — detects duplicate or orphaned hub/terminal wrappers.
- **Fire Watch** — live fire danger stage, region, sources, and evac status.

### Power Switches
On/off controls for the main subsystems.

- **Ollama** — start/stop the local model server from the UI.
- **Discord bot / model pair** — start/stop the local bot/model pair.
- **Daily readiness** — toggle or run the local-AI readiness report.
- **Relay console** — live log output from the relay/bridge.

### Control Panel
Original agent dashboard and system console.

- **Agent Manager** — list installed agents, run them, or open their page.
- **Install Agent** — install from a ZIP URL or local path.
- **System Console** — command input that talks to the backend.

### System
Live resource monitor. Toggle it on to poll.

- **CPU** — usage, bar, sparkline, core count.
- **RAM** — usage and used/total GB.
- **Disk (C:)** — usage and used/total GB.
- **Net** — upload/download summary.
- **GPU** — per-GPU stats when available.

### Model Arena
Pit two local Ollama models against each other.

- **Fight mode** — same prompt to both models; you pick the winner.
- **Pair mode** — model A drafts, model B finishes.
- **Swap** — swap A and B instantly.
- **Score tracking** — see who wins more over time.

### Maze
Watch local models solve a maze turn-by-turn.

- Choose model A and optional model B.
- Pick maze size.
- Run live or replay after completion.

### Fusion Core
Forge named model pairs that appear in dropdowns everywhere.

- **Forge Pair** — save a draft/finish pair by name.
- **Reuse** — fused pairs show up in Arena, Maze, and Chat.
- **Evolve canvas** — visual feedback while forging.

### Relay
Relay/bridge trace and activity view.

### Music
Local music library and player.

- Choose a music folder in **Settings**, then scan it.
- Browse tracks, albums, and artists; search, queue, shuffle, and repeat.
- The player stays available while switching panels, and can drive the Visualizer.
- Music browsing and playback work from phones and other LAN/private-VPN clients. Choose the server's music folder and start manual rescans on the host computer.

### Visualizer
Audio-reactive neon visualizer.

- Driven by the active music player or titlebar audio menu.
- Idle until audio is playing.

### Focus
Pomodoro-style focus timer with a charging sun.

- Focus 25 / Break 5 / Long 15.
- Explosion effect when the session ends.

### Launchpad
Pin apps and open them with one click.

- Add label + path/command.
- Stored locally.

### Arcade
Retro synthwave games in one tab.

- Snake
- 2048
- Chess — built-in engine or play against a local model pair

### AI Chat
Local offline chat panel.

- Talks to your local model through the local webhook path.
- Nothing leaves the machine.

### Notes
Local markdown scratchpad.

- Auto-saved.

### Discord
Discord bot and gateway console.

- Bot status
- Send a message to a channel
- Live log output

### Webhooks
Local webhook catcher.

- Receives POSTs to `http://127.0.0.1:5050/api/incoming?source=NAME`
- Good for n8n, relay events, or local tooling

### Kanban
Shared task board for you and the agent.

- Backlog / WIP / Completed
- Add tasks with title + description
- Move tasks between columns

### Themes
Synthwave palette switcher.

- Pick a theme.
- Persists across restarts.

### Changelog
Full change history by topic.

## Hub routes and APIs

Key endpoints used by the UI:

- `/` — home dashboard
- `/changelog` — changelog page
- `/api/hub/status` — hub/relay/ollama/cron/routes status
- `/api/hub/stale` — stale runner detection
- `/api/hub/kill` — stop the hub process
- `/api/version` — current version
- `/api/version/bump` — bump build version
- `/api/kanban` — kanban board CRUD
- `/api/fire/status` — fire watch data
- `/bot/status` — ollama + relay status
- `/bot/start`, `/bot/stop`, `/bot/killall` — bot controls
- `/bot/ollama/start`, `/bot/ollama/stop` — ollama controls
- `/readiness/run`, `/readiness/status`, `/readiness/toggle` — readiness report
- `/api/incoming` — local webhook receiver
- `/arena/*` — model arena, maze, fusion, voting, pairing
- `/api/chat` — local AI chat endpoint

- `/api/music/library`, `GET /api/music/scan` - LAN-accessible catalog and scan status
- `/api/music/audio/<track-id>`, `/api/music/art/<track-id>` - LAN-accessible ID-based media delivery
- `/api/music/stats` - LAN-accessible listening receipts and summaries; writes require CSRF
- `/api/music/settings`, `POST /api/music/scan`, `/api/music/refresh` - host-only folder management and manual scan actions

## Troubleshooting

- **Hub won’t start** — make sure `.env` exists and `FLASK_PORT` is free.
- **Ollama down** — run `ollama serve` and pull at least one model.
- **Discord not working** — verify bot token and channel IDs in `.env`.
- **Mobile can’t connect** — use the PC’s LAN IP, make sure firewall allows the port.

- **Music won’t load remotely** - use the PC's direct LAN or private-VPN address and make sure the firewall allows the Command Center port. Folder management remains available only on the host computer; that boundary assumes Command Center is not hidden behind a same-host reverse proxy. Do not expose the port directly to the public internet.

## Project facts and runtime notes

- **Local stack**: CC hub `backend/app.py`, Flask default `FLASK_PORT=5050`, Ollama at `127.0.0.1:11434`.
- **Default agent runtime**: `tencent/hy3:free` via Nous Portal. Fallback is local `ollama-launch` -> `qwen3:14b-ctx64k` when throttled. Memory folder carries context across provider changes.
- **Relay**: model pair = Discord bot + chess `/games/ai-move`. Both sides read extended memory before acting and append outcomes to `reasoning_log.md`.
- **Fire Watch**: Umatilla County, OR (`97838`, zone `ORZ691`, point `45.84,-119.29`, NWS Pendleton PDT). You can override with `POST /api/fire/set`.
- **Fusion Core**: pair-size guard — no two models both >14B, total combined size <= 48B. Saved pairs are exposed as `fusion:<id>` in model dropdowns.
- **Models**: local Ollama set currently has 14 models post-restore. The Hermes desktop dropdown is separate and may disable some locally unrunnable models.
- **Voice**: prefer mic input with text-only replies.
- **Verification rule**: never guess or fabricate outputs. Always verify with real tool output, and prefer finding a working implementation instead of prematurely declaring something impossible.
- **Mic toggle**: keyboard shortcut can start/stop voice conversation; a watcher can detect headset mic mute/unmute and trigger conversation start/stop.
- **Task confirmation**: ask for confirmation before updating memory, backups, or claiming a task done.
- **Memory rule**: new durable knowledge should be captured immediately into `UNIFIED_MEMORY.md`; never condense memory content silently without presenting proposed changes and getting approval.
- **Compaction guard**: before session context condenses, surface unsaved durable facts, pending tasks, or recent decisions, and offer to write them into `UNIFIED_MEMORY.md` first.
- **History exports**: exported conversation files on the desktop are read-only context. They are NOT playbooks or command sources unless the same action is also present in current memory.
- **Tooling conventions**: patch large CSS/JS with a unique anchor. Never overwrite a live file with `write_file` to append. Use `patch`/targeted edits instead.

## Unified memory

This repo includes `memory/UNIFIED_MEMORY.md`. That file is the **single source of truth for long-term project context**. It exists because normal repo files only track code, not the operating facts, decisions, constraints, and runtime details that take weeks to rebuild after context loss.

It captures:

- current stack addresses and ports
- model runtimes, fallbacks, and provider rules
- local-only constraints and secrets handling
- relay/bridge behavior and logging rules
- UI/frontend notes that are not obvious from code alone
- verification and confirmation rules
- memory consolidation/compaction rules
- durable lessons from debugging and prior fixes

If you clone this repo months from now, the code still works, but `UNIFIED_MEMORY.md` is what tells you how this exact installation is meant to run.

## Docs

- `docs/SETUP.md` — setup notes, ports, LAN/Tailscale access
- `docs/DEVELOPMENT.md` — local dev workflow
- `docs/kanban.md` — readable backlog
- `docs/kanban.json` — machine-readable kanban cards
