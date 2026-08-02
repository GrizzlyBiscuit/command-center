"""Local video library, resume state, streaming, and remote playback."""

from .library import LibrarySnapshot, ScanStatus, Video, VideoLibrary
from .progress import VideoProgress
from .remote import PlaybackCoordinator
from .service import VideoService
from .settings import SettingsStore, VideoSettings, default_data_dir

__all__ = [
    "LibrarySnapshot",
    "PlaybackCoordinator",
    "ScanStatus",
    "SettingsStore",
    "Video",
    "VideoLibrary",
    "VideoProgress",
    "VideoService",
    "VideoSettings",
    "default_data_dir",
    "init_video",
]


def init_video(
    app: object,
    *,
    data_dir: object | None = None,
    service: VideoService | None = None,
    authorize_mutation: object | None = None,
    validate_csrf: object | None = None,
    scan_on_start: bool = True,
) -> VideoService:
    """Attach one video service and its Blueprint to a Flask application."""
    from pathlib import Path

    from .blueprint import create_video_blueprint

    selected = service or VideoService(
        Path(data_dir) if data_dir is not None else None,
        scan_on_start=False,
    )
    app.extensions["cc_video"] = selected  # type: ignore[attr-defined]
    app.register_blueprint(  # type: ignore[attr-defined]
        create_video_blueprint(
            authorize_mutation=authorize_mutation,  # type: ignore[arg-type]
            validate_csrf=validate_csrf,  # type: ignore[arg-type]
        )
    )
    if scan_on_start and selected.settings.configured and not selected.library.status().running:
        selected.start_scan()
    return selected
