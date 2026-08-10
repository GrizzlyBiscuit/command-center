"""Path-safe, bounded lyric sidecar discovery and decoding."""

from __future__ import annotations

import codecs
from dataclasses import dataclass
import os
from pathlib import Path
import re
import stat


MAX_LYRIC_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class LyricDescriptor:
    """Small scan-time metadata; lyric bodies are loaded only on request."""

    source_suffix: str
    format: str
    strip_timing: bool
    byte_size: int


@dataclass(frozen=True, slots=True)
class _SidecarContent:
    source_suffix: str
    text: str
    byte_size: int


def _inside_root(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _same_open_file(opened: os.stat_result, current: os.stat_result) -> bool:
    """Compare an open descriptor with the name resolved after opening it."""
    try:
        return os.path.samestat(opened, current)
    except (AttributeError, OSError):
        return (opened.st_dev, opened.st_ino) == (current.st_dev, current.st_ino)


def _read_bounded_bytes(path: Path, root: Path) -> bytes | None:
    """Read one regular in-root file through one handle, capped at MAX+1."""
    descriptor: int | None = None
    try:
        resolved_root = root.resolve(strict=True)
        flags = os.O_RDONLY
        flags |= getattr(os, "O_BINARY", 0)
        flags |= getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NONBLOCK", 0)
        descriptor = os.open(path, flags)

        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            return None
        if opened.st_size < 0 or opened.st_size > MAX_LYRIC_BYTES:
            return None

        # Resolve and stat only after opening.  A swapped symlink/name either
        # leaves the root or no longer identifies the handle we will read.
        resolved_path = path.resolve(strict=True)
        if not _inside_root(resolved_path, resolved_root):
            return None
        current = resolved_path.stat()
        if not _same_open_file(opened, current):
            return None

        chunks: list[bytes] = []
        remaining = MAX_LYRIC_BYTES + 1
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)

        finished = os.fstat(descriptor)
        if len(payload) > MAX_LYRIC_BYTES:
            return None
        if (
            not _same_open_file(opened, finished)
            or finished.st_size != opened.st_size
            or finished.st_mtime_ns != opened.st_mtime_ns
            or len(payload) != opened.st_size
        ):
            # A sidecar changed while being read.  It is optional, so wait for
            # the next scan/request rather than serving a torn lyric body.
            return None
        return payload
    except (OSError, ValueError):
        return None
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass


def _valid_decoded_text(value: str, *, reject_halfwidth_dominance: bool = False) -> bool:
    if "\x00" in value:
        return False
    if any(ord(character) < 32 and character not in "\r\n\t" for character in value):
        return False
    if reject_halfwidth_dominance:
        non_ascii = [character for character in value if ord(character) > 127 and not character.isspace()]
        halfwidth = [character for character in non_ascii if "\uff61" <= character <= "\uff9f"]
        # CP949 Hangul bytes can be legal CP932 single-byte halfwidth kana.
        # Treat a halfwidth-dominated decode as ambiguous so strict CP949 gets
        # a chance; normal Japanese CP932 lyrics use kana/kanji double bytes.
        if len(halfwidth) >= 2 and len(halfwidth) * 2 >= len(non_ascii):
            return False
    return True


def _strict_decode(payload: bytes, encoding: str, *, reject_halfwidth: bool = False) -> str | None:
    try:
        value = payload.decode(encoding, errors="strict")
        # Generic UTF-16 re-encodes using the host byte order, so a valid
        # opposite-endian BOM is not expected to byte-roundtrip.
        if encoding != "utf-16" and value.encode(encoding, errors="strict") != payload:
            return None
    except (UnicodeDecodeError, UnicodeEncodeError):
        return None
    return value if _valid_decoded_text(value, reject_halfwidth_dominance=reject_halfwidth) else None


def _bomless_utf16_encoding(payload: bytes) -> str | None:
    if len(payload) < 4 or len(payload) % 2:
        return None
    even = payload[0::2]
    odd = payload[1::2]
    even_nuls = even.count(0)
    odd_nuls = odd.count(0)
    minimum = max(2, len(even) // 5)
    if odd_nuls >= minimum and even_nuls * 4 <= odd_nuls:
        return "utf-16-le"
    if even_nuls >= minimum and odd_nuls * 4 <= even_nuls:
        return "utf-16-be"
    return None


def decode_lyric_bytes(payload: bytes) -> str:
    """Decode common lyric encodings from one already-bounded byte buffer."""
    if not payload:
        return ""

    if payload.startswith(codecs.BOM_UTF8):
        candidates = (("utf-8-sig", False),)
    elif payload.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        candidates = (("utf-16", False),)
    else:
        utf16 = _bomless_utf16_encoding(payload)
        candidates = ((utf16, False),) if utf16 else (
            ("utf-8", False),
            ("cp932", True),
            ("cp949", False),
        )

    for encoding, reject_halfwidth in candidates:
        if not encoding:
            continue
        decoded = _strict_decode(payload, encoding, reject_halfwidth=reject_halfwidth)
        if decoded is not None:
            return decoded.replace("\r\n", "\n").replace("\r", "\n").strip()

    # A declared BOM or strong UTF-16 byte pattern should retain that codec on
    # malformed input.  Otherwise use the legacy codec producing the fewest
    # replacement characters, preferring CP932 on a tie.
    if len(candidates) == 1:
        replacement_encoding = candidates[0][0] or "utf-8"
        decoded = payload.decode(replacement_encoding, errors="replace")
    else:
        replacements = [payload.decode(encoding, errors="replace") for encoding in ("cp932", "cp949")]
        decoded = min(replacements, key=lambda value: value.count("\ufffd"))
    return decoded.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n").strip()


def read_lyric_text(path: Path, root: Path | None = None) -> str:
    """Read a sidecar once, with a byte cap and path-boundary validation."""
    safe_root = root if root is not None else path.parent
    payload = _read_bounded_bytes(path, safe_root)
    return decode_lyric_bytes(payload) if payload is not None else ""


def _sidecar_content(audio_path: Path, suffix: str, root: Path) -> _SidecarContent | None:
    path = audio_path.with_suffix(suffix)
    payload = _read_bounded_bytes(path, root)
    if payload is None:
        return None
    text = decode_lyric_bytes(payload)
    return _SidecarContent(suffix, text, len(payload)) if text else None


def timed_lrc_cue_timestamps(content: str) -> list[str]:
    """Return every timed cue, including blank rows that clear the lyric."""
    timestamps: list[str] = []
    for line in content.splitlines():
        timestamps.extend(
            re.findall(r"\[([0-9]{1,2}:[0-9]{2}(?:[.:][0-9]{1,3})?)\]", line)
        )
    return timestamps


def strip_lrc_timing(content: str) -> str:
    """Remove LRC metadata/timestamps while retaining readable text."""
    lines: list[str] = []
    for line in content.splitlines():
        text = re.sub(r"\[[^\]]+\]", "", line).strip()
        if text and not text.startswith("#"):
            lines.append(text)
    return "\n".join(lines).strip()


def _timing_matches(english_lrc: str, raw_lrc: str) -> bool:
    if not raw_lrc:
        return True
    english_timestamps = timed_lrc_cue_timestamps(english_lrc)
    raw_timestamps = timed_lrc_cue_timestamps(raw_lrc)
    return bool(
        english_timestamps
        and raw_timestamps
        and english_timestamps == raw_timestamps
    )


def _selection(audio_path: Path, root: Path) -> tuple[LyricDescriptor | None, str]:
    english_lrc = _sidecar_content(audio_path, ".en.lrc", root)
    raw_lrc = _sidecar_content(audio_path, ".lrc", root)

    if english_lrc and _timing_matches(english_lrc.text, raw_lrc.text if raw_lrc else ""):
        return (
            LyricDescriptor(english_lrc.source_suffix, "lrc", False, english_lrc.byte_size),
            english_lrc.text,
        )

    english_text = _sidecar_content(audio_path, ".en.txt", root)
    if english_text:
        return (
            LyricDescriptor(english_text.source_suffix, "text", False, english_text.byte_size),
            english_text.text,
        )

    if english_lrc:
        plain_english = strip_lrc_timing(english_lrc.text)
        if plain_english:
            return (
                LyricDescriptor(english_lrc.source_suffix, "text", True, english_lrc.byte_size),
                plain_english,
            )

    if raw_lrc:
        return (
            LyricDescriptor(raw_lrc.source_suffix, "lrc", False, raw_lrc.byte_size),
            raw_lrc.text,
        )

    plain_text = _sidecar_content(audio_path, ".txt", root)
    if plain_text:
        return (
            LyricDescriptor(plain_text.source_suffix, "text", False, plain_text.byte_size),
            plain_text.text,
        )
    return None, ""


def describe_lyrics(audio_path: Path, root: Path) -> LyricDescriptor | None:
    """Discover lyrics while retaining only bounded metadata in the catalog."""
    descriptor, _text = _selection(audio_path, root)
    return descriptor


def lyrics_for_track(audio_path: Path, root: Path) -> tuple[str, str]:
    """Load the current best safe sidecar on demand."""
    descriptor, text = _selection(audio_path, root)
    if descriptor is None or not text:
        return "", ""
    return text, descriptor.format
