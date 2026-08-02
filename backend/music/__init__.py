"""Local, privacy-preserving music library services for Command Center.

The package deliberately has no Flask import at module-import time.  The
framework-neutral :class:`MusicService` can therefore be tested and reused by
desktop launchers that do not install Flask.
"""

from .library import LibrarySnapshot, MusicLibrary, ScanStatus, Track
from .service import MusicService
from .settings import MusicSettings, SettingsStore, default_data_dir
from .stats import ListeningStats

__all__ = [
    "LibrarySnapshot",
    "ListeningStats",
    "MusicLibrary",
    "MusicService",
    "MusicSettings",
    "ScanStatus",
    "SettingsStore",
    "Track",
    "default_data_dir",
    "init_music",
]


def init_music(
    app: object,
    *,
    data_dir: object | None = None,
    service: MusicService | None = None,
    authorize_mutation: object | None = None,
    validate_csrf: object | None = None,
    scan_on_start: bool = True,
) -> MusicService:
    """Attach one service and its Blueprint to a Flask application.

    Construction only reads existing settings.  SQLite is initialized lazily;
    an optional startup scan is queued on a daemon thread, never run inline.
    """
    from pathlib import Path

    from .blueprint import create_music_blueprint

    selected = service or MusicService(
        Path(data_dir) if data_dir is not None else None,
        scan_on_start=False,
    )
    app.extensions["cc_music"] = selected  # type: ignore[attr-defined]
    app.register_blueprint(  # type: ignore[attr-defined]
        create_music_blueprint(
            authorize_mutation=authorize_mutation,  # type: ignore[arg-type]
            validate_csrf=validate_csrf,  # type: ignore[arg-type]
        )
    )
    if scan_on_start and selected.settings.configured and not selected.library.status().running:
        selected.start_scan()
    return selected
