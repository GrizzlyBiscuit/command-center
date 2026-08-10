"""Recursive, path-safe music scanning with atomic immutable snapshots."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
import hashlib
import mimetypes
import os
from pathlib import Path
import secrets
import threading
from types import MappingProxyType
from typing import Callable, Iterable, Mapping

from .lyrics import LyricDescriptor, describe_lyrics, lyrics_for_track
from .metadata import AUDIO_EXTENSIONS, Artwork, read_artwork, read_metadata
from .settings import MusicSettings


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _inside_root(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def stable_track_id(library_id: str, relative_path: Path) -> str:
    """Return an opaque ID namespaced by the resolved-root library ID."""
    normalized = relative_path.as_posix()
    if os.name == "nt":
        normalized = normalized.casefold()
    identity = f"{library_id}\0{normalized}"
    return hashlib.sha256(identity.encode("utf-8", errors="surrogatepass")).hexdigest()[:32]


@dataclass(frozen=True)
class Track:
    id: str
    library_id: str
    path: Path = field(repr=False, compare=False)
    filename: str
    title: str
    artist: str
    album: str
    album_artist: str
    genre: str
    date: str
    track_number: str
    duration: float
    format: str
    mime_type: str
    byte_size: int
    bitrate_kbps: int
    sample_rate_hz: int
    bit_depth: int
    has_artwork: bool
    has_lyrics: bool = False
    lyrics_format: str = ""

    def public_dict(self) -> dict[str, object]:
        data = asdict(self)
        data.pop("path", None)
        data.pop("filename", None)
        data["audio_url"] = f"/api/music/audio/{self.id}"
        data["artwork_url"] = f"/api/music/art/{self.id}" if self.has_artwork else ""
        data["lyrics_url"] = f"/api/music/lyrics/{self.id}" if self.has_lyrics else ""
        return data


@dataclass(frozen=True)
class CachedArtwork:
    content_hash: str
    mime: str
    path: Path = field(repr=False, compare=False)


@dataclass(frozen=True)
class LibrarySnapshot:
    library_id: str = ""
    root: Path | None = field(default=None, repr=False, compare=False)
    tracks: tuple[Track, ...] = ()
    tracks_by_id: Mapping[str, Track] = field(default_factory=lambda: MappingProxyType({}), repr=False)
    artwork_by_id: Mapping[str, Artwork | CachedArtwork] = field(
        default_factory=lambda: MappingProxyType({}), repr=False
    )
    lyrics_by_id: Mapping[str, LyricDescriptor] = field(
        default_factory=lambda: MappingProxyType({}), repr=False
    )
    scanned_at: str = ""

    @classmethod
    def build(
        cls,
        *,
        library_id: str,
        root: Path,
        tracks: Iterable[Track],
        artwork: Mapping[str, Artwork | CachedArtwork],
        lyrics: Mapping[str, LyricDescriptor] | None = None,
    ) -> "LibrarySnapshot":
        ordered = tuple(sorted(tracks, key=lambda item: (item.artist.casefold(), item.album.casefold(), item.title.casefold())))
        by_id = MappingProxyType({item.id: item for item in ordered})
        return cls(
            library_id=library_id,
            root=root,
            tracks=ordered,
            tracks_by_id=by_id,
            artwork_by_id=MappingProxyType(dict(artwork)),
            lyrics_by_id=MappingProxyType(dict(lyrics or {})),
            scanned_at=_utc_now(),
        )

    def public_dict(self, query: str = "") -> dict[str, object]:
        needle = query.strip().casefold()
        tracks = self.tracks
        if needle:
            tracks = tuple(
                track
                for track in tracks
                if needle in " ".join((track.title, track.artist, track.album, track.genre, track.filename)).casefold()
            )
        artists = sorted({track.artist for track in tracks}, key=str.casefold)
        albums = sorted({track.album for track in tracks}, key=str.casefold)
        return {
            "library_id": self.library_id,
            "scanned_at": self.scanned_at,
            "count": len(tracks),
            "artists": artists,
            "albums": albums,
            "tracks": [track.public_dict() for track in tracks],
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
            "poll_url": "/api/music/scan",
        }


class MusicLibrary:
    """Own an atomic snapshot and perform one background scan at a time."""

    def __init__(
        self,
        *,
        metadata_reader: Callable[[Path], dict[str, str | int | float]] = read_metadata,
        artwork_reader: Callable[[Path], Artwork | None] = read_artwork,
        artwork_cache_dir: Path | None = None,
    ) -> None:
        self._metadata_reader = metadata_reader
        self._artwork_reader = artwork_reader
        self.artwork_cache_dir = artwork_cache_dir.resolve() if artwork_cache_dir else None
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
            # Invalidate an in-flight worker.  It may finish reading its current
            # file, but its scan ID can no longer publish the old root.
            self._status = ScanStatus(scan_id=self._status.scan_id + 1, library_id=library_id)

    def start_scan(self, settings: MusicSettings) -> ScanStatus:
        if not settings.configured:
            raise ValueError("music folder is not configured")
        root = Path(settings.music_folder).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("music folder is not available")
        with self._lock:
            if self._status.running:
                return self._status
            next_id = self._status.scan_id + 1
            self._status = ScanStatus(
                state="running",
                scan_id=next_id,
                started_at=_utc_now(),
                library_id=settings.library_id,
            )
            thread = threading.Thread(
                target=self._scan_worker,
                args=(settings, root, next_id),
                name=f"music-scan-{next_id}",
                daemon=True,
            )
            thread.start()
            return self._status

    def scan_now(self, settings: MusicSettings) -> ScanStatus:
        """Scan synchronously; intended for startup jobs and focused tests."""
        if not settings.configured:
            raise ValueError("music folder is not configured")
        root = Path(settings.music_folder).resolve(strict=True)
        with self._lock:
            if self._status.running:
                raise RuntimeError("a music scan is already running")
            next_id = self._status.scan_id + 1
            self._status = ScanStatus(
                state="running", scan_id=next_id, started_at=_utc_now(), library_id=settings.library_id
            )
        self._scan_worker(settings, root, next_id)
        return self.status()

    def _progress(self, scan_id: int, **changes: int) -> None:
        with self._lock:
            if self._status.scan_id != scan_id:
                return
            data = asdict(self._status)
            data.update(changes)
            self._status = ScanStatus(**data)

    def _scan_worker(self, settings: MusicSettings, root: Path, scan_id: int) -> None:
        tracks: list[Track] = []
        artwork: dict[str, Artwork | CachedArtwork] = {}
        lyrics: dict[str, LyricDescriptor] = {}
        artwork_intern: dict[str, Artwork | CachedArtwork] = {}
        skipped = 0
        try:
            candidates = sorted(
                self._iter_audio_files(root, recursive=settings.recursive),
                key=lambda item: item.as_posix().casefold(),
            )
            self._progress(scan_id, discovered=len(candidates))
            for path in candidates:
                try:
                    track, cover, lyric_descriptor = self._read_track(settings, root, path)
                except (OSError, ValueError):
                    skipped += 1
                    self._progress(scan_id, scanned=len(tracks), skipped=skipped)
                    continue
                if cover is not None:
                    try:
                        digest = hashlib.sha256(cover.data).hexdigest()
                        reference = artwork_intern.get(digest)
                        if reference is None:
                            reference = self._cache_artwork(digest, cover)
                            artwork_intern[digest] = reference
                        artwork[track.id] = reference
                    except OSError:
                        # A cache problem should not make playable audio vanish
                        # or advertise an artwork URL that will return 404.
                        track = replace(track, has_artwork=False)
                if lyric_descriptor is not None:
                    lyrics[track.id] = lyric_descriptor
                tracks.append(track)
                self._progress(scan_id, scanned=len(tracks), skipped=skipped)
            snapshot = LibrarySnapshot.build(
                library_id=settings.library_id,
                root=root,
                tracks=tracks,
                artwork=artwork,
                lyrics=lyrics,
            )
            with self._lock:
                # Publish every map together so requests never observe a partial scan.
                if self._status.scan_id == scan_id:
                    self._snapshot = snapshot
                    self._status = ScanStatus(
                        state="complete",
                        scan_id=scan_id,
                        started_at=self._status.started_at,
                        finished_at=_utc_now(),
                        discovered=len(candidates),
                        scanned=len(tracks),
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
                        scanned=len(tracks),
                        skipped=skipped,
                        error=f"{type(exc).__name__}: music scan failed",
                        library_id=settings.library_id,
                    )

    def _iter_audio_files(self, root: Path, *, recursive: bool) -> Iterable[Path]:
        candidates = root.rglob("*") if recursive else root.iterdir()
        for path in candidates:
            try:
                if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
                    continue
                resolved = path.resolve(strict=True)
            except OSError:
                continue
            # A symlink inside the library must never make arbitrary files streamable.
            if _inside_root(resolved, root):
                yield resolved

    def _read_track(
        self, settings: MusicSettings, root: Path, path: Path
    ) -> tuple[Track, Artwork | None, LyricDescriptor | None]:
        relative = path.relative_to(root)
        stat = path.stat()
        metadata = self._metadata_reader(path)
        cover = self._artwork_reader(path)
        lyric_descriptor = describe_lyrics(path, root)
        suffix = path.suffix.lower()
        mime = mimetypes.guess_type(path.name)[0] or {
            ".flac": "audio/flac",
            ".m4a": "audio/mp4",
            ".opus": "audio/ogg",
        }.get(suffix, "application/octet-stream")

        def text(key: str, fallback: str) -> str:
            value = str(metadata.get(key, "") or "").strip()
            return value[:500] or fallback

        def number(key: str, as_int: bool = False) -> int | float:
            try:
                value = max(0.0, float(metadata.get(key, 0) or 0))
            except (TypeError, ValueError, OverflowError):
                value = 0.0
            return int(round(value)) if as_int else round(value, 3)

        return (
            Track(
                id=stable_track_id(settings.library_id, relative),
                library_id=settings.library_id,
                path=path,
                filename=path.name,
                title=text("title", path.stem),
                artist=text("artist", "Unknown artist"),
                album=text("album", path.parent.name or "Unknown album"),
                album_artist=text("album_artist", ""),
                genre=text("genre", ""),
                date=text("date", ""),
                track_number=text("track_number", ""),
                duration=float(number("duration")),
                format=suffix.removeprefix(".").upper(),
                mime_type=mime,
                byte_size=stat.st_size,
                bitrate_kbps=int(number("bitrate_kbps", True)),
                sample_rate_hz=int(number("sample_rate_hz", True)),
                bit_depth=int(number("bit_depth", True)),
                has_artwork=cover is not None,
                has_lyrics=lyric_descriptor is not None,
                lyrics_format=lyric_descriptor.format if lyric_descriptor else "",
            ),
            cover,
            lyric_descriptor,
        )

    def resolve_track(self, track_id: str) -> Track | None:
        """Resolve only an opaque catalog ID and recheck the file boundary."""
        snapshot = self.snapshot()
        track = snapshot.tracks_by_id.get(track_id)
        if track is None or snapshot.root is None:
            return None
        try:
            path = track.path.resolve(strict=True)
        except OSError:
            return None
        if not path.is_file() or not _inside_root(path, snapshot.root):
            return None
        return track

    def _cache_artwork(self, digest: str, artwork: Artwork) -> Artwork | CachedArtwork:
        if self.artwork_cache_dir is None:
            return artwork
        extension = {"image/png": ".png", "image/webp": ".webp"}.get(artwork.mime, ".jpg")
        self.artwork_cache_dir.mkdir(parents=True, exist_ok=True)
        destination = self.artwork_cache_dir / f"{digest}{extension}"
        if not destination.exists():
            temporary = destination.with_name(
                f".{destination.name}.{secrets.token_hex(8)}.tmp"
            )
            try:
                temporary.write_bytes(artwork.data)
                os.replace(temporary, destination)
            finally:
                try:
                    temporary.unlink()
                except FileNotFoundError:
                    pass
        return CachedArtwork(content_hash=digest, mime=artwork.mime, path=destination)

    def artwork_for(self, track_id: str) -> Artwork | CachedArtwork | None:
        snapshot = self.snapshot()
        return snapshot.artwork_by_id.get(track_id) if track_id in snapshot.tracks_by_id else None

    def lyrics_for(self, track_id: str) -> tuple[str, str] | None:
        snapshot = self.snapshot()
        track = snapshot.tracks_by_id.get(track_id)
        descriptor = snapshot.lyrics_by_id.get(track_id)
        if track is None or descriptor is None or snapshot.root is None:
            return None
        lyrics, lyric_format = lyrics_for_track(track.path, snapshot.root)
        if not lyrics:
            return None
        return lyrics, lyric_format or descriptor.format
