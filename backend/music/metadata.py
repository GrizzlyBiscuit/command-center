"""Best-effort audio metadata and embedded artwork extraction.

Portions are adapted from Taeyeon Media Player (MIT); see the license file in
this package.  Mutagen is optional at runtime: filename metadata remains
available when it is absent or a file is corrupt.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Any

try:  # pragma: no cover - which branch runs depends on the installation
    from mutagen import File as MutagenFile
    from mutagen.flac import FLAC
    from mutagen.id3 import APIC, ID3
    from mutagen.mp4 import MP4, MP4Cover
except ImportError:  # optional enhancement, never a startup requirement
    MutagenFile = None
    FLAC = ID3 = MP4 = None
    APIC = MP4Cover = None


# MP4 is intentionally omitted: it is often video, while M4A is unambiguous.
AUDIO_EXTENSIONS = frozenset(
    {".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".wave", ".wma"}
)
MAX_ARTWORK_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class Artwork:
    data: bytes
    mime: str


def _first_value(audio: object, keys: tuple[str, ...]) -> str:
    for key in keys:
        try:
            values = audio.get(key, [])  # type: ignore[attr-defined]
        except Exception:
            values = []
        if values:
            return str(values[0]).strip()
    return ""


def _positive_number(info: object | None, attribute: str) -> float:
    try:
        number = float(getattr(info, attribute, 0))
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return number if math.isfinite(number) and number > 0 else 0.0


def read_metadata(path: Path) -> dict[str, str | int | float]:
    """Read normalized metadata, returning an empty mapping on any failure."""
    if MutagenFile is None:
        return {}
    try:
        audio = MutagenFile(path, easy=True)
    except Exception:
        return {}
    if audio is None:
        return {}
    try:
        info = audio.info
    except Exception:
        info = None
    bitrate = _positive_number(info, "bitrate")
    return {
        "title": _first_value(audio, ("title",)),
        "artist": _first_value(audio, ("artist", "albumartist", "album_artist")),
        "album": _first_value(audio, ("album",)),
        "album_artist": _first_value(audio, ("albumartist", "album_artist")),
        "genre": _first_value(audio, ("genre",)),
        "date": _first_value(audio, ("date", "originaldate", "year")),
        "track_number": _first_value(audio, ("tracknumber", "track")),
        "duration": round(_positive_number(info, "length"), 3),
        "bitrate_kbps": round(bitrate / 1000) if bitrate else 0,
        "sample_rate_hz": round(_positive_number(info, "sample_rate")),
        "bit_depth": round(_positive_number(info, "bits_per_sample")),
    }


def _safe_artwork(data: bytes, mime: str) -> Artwork | None:
    if not data or len(data) > MAX_ARTWORK_BYTES:
        return None
    normalized_mime = mime if mime in {"image/jpeg", "image/png", "image/webp"} else "image/jpeg"
    return Artwork(data=bytes(data), mime=normalized_mime)


def read_artwork(path: Path) -> Artwork | None:
    """Return a supported embedded cover image, or ``None``."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".flac" and FLAC is not None:
            audio = FLAC(path)
            if audio.pictures:
                picture = audio.pictures[0]
                return _safe_artwork(picture.data, picture.mime or "image/jpeg")
        if suffix == ".mp3" and ID3 is not None and APIC is not None:
            tags = ID3(path)
            for frame in tags.values():
                if isinstance(frame, APIC):
                    return _safe_artwork(frame.data, frame.mime or "image/jpeg")
        if suffix == ".m4a" and MP4 is not None:
            audio = MP4(path)
            covers = audio.tags.get("covr", []) if audio.tags else []
            if covers:
                cover = covers[0]
                png_format = getattr(MP4Cover, "FORMAT_PNG", object())
                mime = "image/png" if getattr(cover, "imageformat", None) == png_format else "image/jpeg"
                return _safe_artwork(bytes(cover), mime)
    except Exception:
        return None
    return None
