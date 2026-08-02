"""Framework-neutral orchestration for video settings, scanning, and resume state."""

from __future__ import annotations

from collections.abc import Collection
from pathlib import Path
import threading
from typing import Any

from .library import ScanStatus, Video, VideoLibrary
from .progress import MAX_RECENT_ITEMS, VideoProgress
from .remote import PlaybackCoordinator
from .settings import SettingsStore, VideoSettings


class VideoService:
    """Single integration surface stored in ``app.extensions['cc_video']``."""

    def __init__(
        self,
        data_dir: Path | None = None,
        *,
        settings_store: SettingsStore | None = None,
        library: VideoLibrary | None = None,
        progress: VideoProgress | None = None,
        scan_on_start: bool = False,
    ) -> None:
        self.settings_store = settings_store or SettingsStore(data_dir)
        self.data_dir = self.settings_store.data_dir
        self.library = library or VideoLibrary()
        self.progress = progress or VideoProgress(self.data_dir / "video-progress.sqlite3")
        self._lock = threading.RLock()
        self._settings = self.settings_store.load()
        self.library.clear(self._settings.library_id)
        self.remote = PlaybackCoordinator(self.catalog_video_ids)
        self.scan_on_start_requested = bool(scan_on_start)

    @property
    def settings(self) -> VideoSettings:
        with self._lock:
            return self._settings

    def settings_payload(self) -> dict[str, Any]:
        settings = self.settings
        folder_name = Path(settings.video_folder).name if settings.video_folder else ""
        return {
            **settings.public_dict(),
            "folder_name": folder_name,
            "scan": self.library.status().public_dict(),
        }

    def configure_folder(
        self,
        video_folder: str,
        *,
        recursive: bool = True,
        scan: bool = True,
    ) -> dict[str, Any]:
        settings = self.settings_store.set_video_folder(video_folder, recursive=recursive)
        with self._lock:
            self._settings = settings
            self.library.clear(settings.library_id)
            status = self.library.start_scan(settings) if scan else self.library.status()
        payload = self.settings_payload()
        payload["scan"] = status.public_dict()
        return payload

    def start_scan(self) -> ScanStatus:
        return self.library.start_scan(self.settings)

    def catalog(self, query: str = "", *, recent_limit: int = 20) -> dict[str, object]:
        snapshot = self.library.snapshot()
        result = snapshot.public_dict(query)
        settings = self.settings
        scan = self.library.status().public_dict()
        result.update(
            {
                "configured": settings.configured,
                "state": scan["state"],
                "scan": scan,
                "total": len(snapshot.videos),
                "recent": self.progress.recent(
                    settings.library_id,
                    snapshot.videos_by_id,
                    limit=recent_limit,
                )
                if settings.configured
                else [],
            }
        )
        return result

    def video(self, video_id: str) -> Video | None:
        return self.library.resolve_video(video_id)

    def catalog_video_ids(self) -> Collection[str]:
        """Return one atomic, stat-free view of the current catalog IDs."""
        return self.library.snapshot().videos_by_id.keys()

    def record_progress(self, video_id: str, payload: dict[str, Any]) -> dict[str, object]:
        video = self.library.resolve_video(video_id)
        if video is None:
            raise LookupError("video not found")
        if "position" not in payload:
            raise ValueError("position is required")
        return self.progress.record(
            library_id=video.library_id,
            video=video,
            position=payload["position"],
            duration=payload.get("duration", video.duration),
            completed=payload.get("completed", False),
        )

    def progress_payload(self, *, limit: int = 20) -> dict[str, object]:
        snapshot = self.library.snapshot()
        if not self.settings.configured:
            # Validate the public limit consistently without initializing SQLite.
            if (
                isinstance(limit, bool)
                or not isinstance(limit, int)
                or not 1 <= limit <= MAX_RECENT_ITEMS
            ):
                raise ValueError(f"limit must be between 1 and {MAX_RECENT_ITEMS}")
            return {"library_id": "", "items": []}
        return {
            "library_id": self.settings.library_id,
            "items": self.progress.recent(
                self.settings.library_id,
                snapshot.videos_by_id,
                limit=limit,
            ),
        }
