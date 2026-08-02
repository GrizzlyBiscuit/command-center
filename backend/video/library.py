"""Recursive, path-safe scanning for browser-streamable video files."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import math
import os
from pathlib import Path
import threading
from types import MappingProxyType
from typing import Callable, Iterable, Mapping

from .settings import VideoSettings


# These containers have broad native HTML5 support.  Codec compatibility is
# still browser/OS dependent, so the server deliberately does not claim to
# transcode or accept arbitrary containers such as MKV or AVI.
VIDEO_TYPES: Mapping[str, str] = MappingProxyType(
    {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
    }
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _inside_root(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def stable_video_id(library_id: str, relative_path: Path) -> str:
    normalized = relative_path.as_posix()
    if os.name == "nt":
        normalized = normalized.casefold()
    identity = f"{library_id}\0{normalized}"
    return hashlib.sha256(identity.encode("utf-8", errors="surrogatepass")).hexdigest()[:32]


@dataclass(frozen=True)
class Video:
    id: str
    library_id: str
    path: Path = field(repr=False, compare=False)
    filename: str
    title: str
    folder: str
    duration: float
    format: str
    mime_type: str
    byte_size: int
    modified_at: str

    def public_dict(self) -> dict[str, object]:
        data = asdict(self)
        data.pop("path", None)
        data.pop("filename", None)
        data["stream_url"] = f"/api/video/stream/{self.id}"
        return data


@dataclass(frozen=True)
class LibrarySnapshot:
    library_id: str = ""
    root: Path | None = field(default=None, repr=False, compare=False)
    videos: tuple[Video, ...] = ()
    videos_by_id: Mapping[str, Video] = field(
        default_factory=lambda: MappingProxyType({}), repr=False
    )
    scanned_at: str = ""

    @classmethod
    def build(
        cls,
        *,
        library_id: str,
        root: Path,
        videos: Iterable[Video],
    ) -> "LibrarySnapshot":
        ordered = tuple(
            sorted(videos, key=lambda item: (item.folder.casefold(), item.title.casefold()))
        )
        return cls(
            library_id=library_id,
            root=root,
            videos=ordered,
            videos_by_id=MappingProxyType({item.id: item for item in ordered}),
            scanned_at=_utc_now(),
        )

    def public_dict(self, query: str = "") -> dict[str, object]:
        needle = query.strip().casefold()
        videos = self.videos
        if needle:
            videos = tuple(
                video
                for video in videos
                if needle in f"{video.folder} {video.title} {video.filename}".casefold()
            )
        return {
            "library_id": self.library_id,
            "scanned_at": self.scanned_at,
            "count": len(videos),
            "videos": [video.public_dict() for video in videos],
        }


@dataclass(frozen=True)
class ScanStatus:
    state: str = "idle"
    scan_id: int = 0
    started_at: str = ""
    finished_at: str = ""
    discovered: int = 0
    scanned: int = 0
    skipped: int = 0
    error: str = ""
    library_id: str = ""

    @property
    def running(self) -> bool:
        return self.state == "running"

    def public_dict(self) -> dict[str, object]:
        return {
            **asdict(self),
            "running": self.running,
            "status": self.state,
            "total": self.discovered,
            "message": self.error,
            "poll_url": "/api/video/scan",
        }


class VideoLibrary:
    """Own an atomic snapshot and perform one background scan at a time."""

    def __init__(
        self,
        *,
        metadata_reader: Callable[[Path], Mapping[str, object]] | None = None,
    ) -> None:
        self._metadata_reader = metadata_reader or (lambda _path: {})
        self._lock = threading.RLock()
        self._snapshot = LibrarySnapshot()
        self._status = ScanStatus()

    def snapshot(self) -> LibrarySnapshot:
        with self._lock:
            return self._snapshot

    def status(self) -> ScanStatus:
        with self._lock:
            return self._status

    def clear(self, library_id: str = "") -> None:
        with self._lock:
            self._snapshot = LibrarySnapshot(library_id=library_id)
            self._status = ScanStatus(
                scan_id=self._status.scan_id + 1,
                library_id=library_id,
            )

    def start_scan(self, settings: VideoSettings) -> ScanStatus:
        if not settings.configured:
            raise ValueError("video folder is not configured")
        root = Path(settings.video_folder).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("video folder is not available")
        with self._lock:
            if self._status.running:
                return self._status
            scan_id = self._status.scan_id + 1
            self._status = ScanStatus(
                state="running",
                scan_id=scan_id,
                started_at=_utc_now(),
                library_id=settings.library_id,
            )
            threading.Thread(
                target=self._scan_worker,
                args=(settings, root, scan_id),
                name=f"video-scan-{scan_id}",
                daemon=True,
            ).start()
            return self._status

    def scan_now(self, settings: VideoSettings) -> ScanStatus:
        if not settings.configured:
            raise ValueError("video folder is not configured")
        root = Path(settings.video_folder).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("video folder is not available")
        with self._lock:
            if self._status.running:
                raise RuntimeError("a video scan is already running")
            scan_id = self._status.scan_id + 1
            self._status = ScanStatus(
                state="running",
                scan_id=scan_id,
                started_at=_utc_now(),
                library_id=settings.library_id,
            )
        self._scan_worker(settings, root, scan_id)
        return self.status()

    def _progress(self, scan_id: int, **changes: int) -> None:
        with self._lock:
            if self._status.scan_id != scan_id:
                return
            data = asdict(self._status)
            data.update(changes)
            self._status = ScanStatus(**data)

    def _scan_worker(self, settings: VideoSettings, root: Path, scan_id: int) -> None:
        videos: list[Video] = []
        skipped = 0
        try:
            candidates = sorted(
                self._iter_video_files(root, recursive=settings.recursive),
                key=lambda item: item.as_posix().casefold(),
            )
            self._progress(scan_id, discovered=len(candidates))
            for path in candidates:
                try:
                    videos.append(self._read_video(settings, root, path))
                except (OSError, ValueError):
                    skipped += 1
                self._progress(scan_id, scanned=len(videos), skipped=skipped)
            snapshot = LibrarySnapshot.build(
                library_id=settings.library_id,
                root=root,
                videos=videos,
            )
            with self._lock:
                if self._status.scan_id == scan_id:
                    self._snapshot = snapshot
                    self._status = ScanStatus(
                        state="complete",
                        scan_id=scan_id,
                        started_at=self._status.started_at,
                        finished_at=_utc_now(),
                        discovered=len(candidates),
                        scanned=len(videos),
                        skipped=skipped,
                        library_id=settings.library_id,
                    )
        except Exception as exc:
            with self._lock:
                if self._status.scan_id == scan_id:
                    self._status = ScanStatus(
                        state="error",
                        scan_id=scan_id,
                        started_at=self._status.started_at,
                        finished_at=_utc_now(),
                        discovered=self._status.discovered,
                        scanned=len(videos),
                        skipped=skipped,
                        error=f"{type(exc).__name__}: video scan failed",
                        library_id=settings.library_id,
                    )

    def _iter_video_files(self, root: Path, *, recursive: bool) -> Iterable[Path]:
        candidates = root.rglob("*") if recursive else root.iterdir()
        seen: set[str] = set()
        for path in candidates:
            try:
                if not path.is_file() or path.suffix.lower() not in VIDEO_TYPES:
                    continue
                resolved = path.resolve(strict=True)
            except OSError:
                continue
            if not _inside_root(resolved, root):
                continue
            identity = os.path.normcase(str(resolved))
            if identity not in seen:
                seen.add(identity)
                yield resolved

    def _read_video(self, settings: VideoSettings, root: Path, path: Path) -> Video:
        relative = path.relative_to(root)
        stat = path.stat()
        metadata = self._metadata_reader(path)
        title = str(metadata.get("title", "") or "").strip()[:500] or path.stem
        try:
            duration = float(metadata.get("duration", 0) or 0)
        except (TypeError, ValueError, OverflowError):
            duration = 0.0
        if not math.isfinite(duration):
            duration = 0.0
        duration = round(max(0.0, duration), 3)
        suffix = path.suffix.lower()
        folder_path = relative.parent.as_posix()
        folder = "(root)" if folder_path == "." else folder_path
        modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(
            timespec="seconds"
        )
        return Video(
            id=stable_video_id(settings.library_id, relative),
            library_id=settings.library_id,
            path=path,
            filename=path.name,
            title=title,
            folder=folder,
            duration=duration,
            format=suffix.removeprefix(".").upper(),
            mime_type=VIDEO_TYPES[suffix],
            byte_size=stat.st_size,
            modified_at=modified,
        )

    def resolve_video(self, video_id: str) -> Video | None:
        snapshot = self.snapshot()
        video = snapshot.videos_by_id.get(video_id)
        if video is None or snapshot.root is None:
            return None
        try:
            path = video.path.resolve(strict=True)
        except OSError:
            return None
        if not path.is_file() or not _inside_root(path, snapshot.root):
            return None
        return video
