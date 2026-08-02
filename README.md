# Command Center

Synthwave Command Center hub + launcher + mobile app + kanban backlog.

## Repo layout

- `backend/` — Flask hub, API, agents, webhooks, game servers, kanban routes
- `frontend/` — templates + static assets (JS, CSS)
- `launcher/` — Windows minimized auto-launch scripts
- `mobile/` — Android WebView app source (`cc-mobile-app/`)
- `docs/` — kanban export, setup, changelog

## Quickstart (Windows)

1. Install Python 3.11+.
2. Install Ollama and start `ollama serve`.
3. Clone repo.
4. Create virtualenv: `python -m venv .venv`
5. Activate: `.venv\Scripts\activate`
6. Install deps: `pip install -r requirements.txt`
7. Copy `.env.example` to `.env` and fill secrets.
8. Run hub: `python backend/app.py`
9. Open `http://localhost:5050` (or `http://0.0.0.0:5050` for LAN).

## Optional launcher (Windows auto-start minimized)

- `launcher/launch_cc.vbs` — starts hub minimized on login.
- `launcher/synth_launcher.py` — launcher helper, patched for hidden console windows.

## Mobile

See `mobile/cc-mobile-app/` for Android build instructions.

## Docs

- `docs/SETUP.md` — full setup notes, ports, Tailscale/LAN access
- `docs/DEVELOPMENT.md` — local dev workflow
- `docs/kanban.md` — readable backlog
- `docs/kanban.json` — machine-readable kanban cards
