# Development

## Backend

- Main entry: `backend/app.py`
- Routes load from `app.py` directly in this version.
- Static assets should be served from `frontend/static/`.
- Templates live in `frontend/templates/`.

Run in debug mode:

```
set FLASK_DEBUG=1
python backend/app.py
```

## Frontend

- Edit JS in `frontend/static/*.js`
- Edit HTML in `frontend/templates/*.html`
- Theme is CSS-var driven in `frontend/static/synthwave.css`

Build step is not required; Flask serves static files directly.

## Mobile

- Android app source: `mobile/cc-mobile-app/`
- Uses WebView wrapper around the hub.
- Update `MainActivity.java` host URL if port changes.

## Kanban

- Live board JSON: `/api/kanban`
- Export: `docs/kanban.json`
- Human readable: `docs/kanban.md`

## Tests

No formal test runner is configured in this repo yet. Use manual route checks via browser or `curl` against `/api/hub/status` and `/api/kanban`.
