"""HTTP byte-range parsing adapted from Taeyeon Media Player (MIT)."""

from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class ByteRange:
    start: int
    end: int
    total: int
    partial: bool

    @property
    def length(self) -> int:
        return self.end - self.start + 1


_RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")


def parse_range_header(value: str | None, file_size: int) -> ByteRange:
    """Parse one HTTP byte range and reject unsupported multi-ranges."""
    if file_size <= 0:
        raise ValueError("empty file")
    if not value:
        return ByteRange(0, file_size - 1, file_size, False)
    match = _RANGE_PATTERN.fullmatch(value.strip())
    if not match:
        raise ValueError("invalid byte range")
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        raise ValueError("invalid byte range")
    if not start_text:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            raise ValueError("invalid suffix range")
        start = max(0, file_size - suffix_length)
        end = file_size - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
        if start >= file_size or end < start:
            raise ValueError("unsatisfiable byte range")
        end = min(end, file_size - 1)
    return ByteRange(start, end, file_size, True)
