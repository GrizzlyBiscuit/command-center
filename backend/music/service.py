"""Framework-neutral orchestration for settings, scanning, and statistics."""

from __future__ import annotations

from pathlib import Path
import threading
from typing import Any

from .library import MusicLibrary, ScanStatus, Track
from .settings import MusicSettings, SettingsStore
from .stats import ListeningStats


class MusicService:
    """Single integration surface stored in ``app.extensions['cc_music']``."""

    def __init__(
        self,
        data_dir: Path | None = None,
        *,
        settings_store: SettingsStore | None = None,
        library: MusicLibrary | None = None,
        stats: ListeningStats | None = None,
        scan_on_start: bool = False,
    ) -> None:
        self.settings_store = settings_store or SettingsStore(data_dir)
        self.data_dir = self.settings_store.data_dir
        self.library = library or MusicLibrary(artwork_cache_dir=self.data_dir / "music-artwork")
        self.stats = stats or ListeningStats(self.data_dir / "music-listening.sqlite3")
        self._lock = threading.RLock()
        self._settings = self.settings_store.load()
        self.library.clear(self._settings.library_id)
        # ``init_music`` queues this only after the extension and Blueprint are
        # registered.  Construction itself remains read-only and non-blocking.
        self.scan_on_start_requested = bool(scan_on_start)

    @property
    def settings(self) -> MusicSettings:
        with self._lock:
            return self._settings

    def settings_payload(self) -> dict[str, Any]:
        settings = self.settings
        folder_name = Path(settings.music_folder).name if settings.music_folder else ""
        return {
            **settings.public_dict(),
            "folder_name": folder_name,
            "scan": self.library.status().public_dict(),
        }

    def configure_folder(
        self, music_folder: str, *, recursive: bool = True, scan: bool = True
    ) -> dict[str, Any]:
        settings = self.settings_store.set_music_folder(music_folder, recursive=recursive)
        with self._lock:
            self._settings = settings
            self.library.clear(settings.library_id)
            status = self.library.start_scan(settings) if scan else self.library.status()
        payload = self.settings_payload()
        payload["scan"] = status.public_dict()
        return payload

    def start_scan(self) -> ScanStatus:
        return self.library.start_scan(self.settings)

    def catalog(self, query: str = "") -> dict[str, object]:
        snapshot = self.library.snapshot()
        result = snapshot.public_dict(query)
        settings = self.settings
        scan = self.library.status().public_dict()
        result.update(
            {
                "configured": settings.configured,
                "state": scan["state"],
                "scan": scan,
                "total": len(snapshot.tracks),
            }
        )
        return result

    def track(self, track_id: str) -> Track | None:
        return self.library.resolve_track(track_id)

    def record_stats(self, payload: dict[str, Any]) -> dict[str, object]:
        track_id = str(payload.get("track_id") or "").strip()
        if not track_id:
            raise ValueError("track_id is required")
        track = self.library.resolve_track(track_id)
        if track is None:
            raise LookupError("track not found")
        return self.stats.record(
            library_id=track.library_id,
            track=track,
            client_event_id=str(payload.get("client_event_id") or ""),
            seconds=payload.get("seconds", 0),
            count_play=payload.get("count_play", False),
        )

    def stats_summary(self, days: int | None = 30) -> dict[str, Any]:
        return self.stats.summary(self.settings.library_id, days)
