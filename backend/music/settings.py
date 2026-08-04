"""Atomic, per-user configuration for the local music library."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
from typing import Any


APP_DIRECTORY_NAME = "CommandCenter"


def default_data_dir() -> Path:
    """Return a writable per-user directory outside the source checkout."""
    configured = os.environ.get("CC_MUSIC_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        return Path(local_app_data).expanduser() / APP_DIRECTORY_NAME
    xdg_data_home = os.environ.get("XDG_DATA_HOME", "").strip()
    if xdg_data_home:
        return Path(xdg_data_home).expanduser() / APP_DIRECTORY_NAME
    return Path.home() / ".local" / "share" / APP_DIRECTORY_NAME


def resolve_music_folder(value: str | os.PathLike[str]) -> Path:
    """Resolve and validate an existing music directory."""
    raw = str(value).strip()
    if not raw:
        raise ValueError("music_folder is required")
    folder = Path(raw).expanduser().resolve(strict=True)
    if not folder.is_dir():
        raise ValueError("music_folder must be an existing directory")
    return folder


def library_id_for(folder: Path, installation_id: str) -> str:
    """Build a non-reversible namespace for a resolved library root."""
    canonical = os.path.normcase(str(folder.resolve(strict=True)))
    identity = f"{installation_id}\0{canonical}"
    return hashlib.sha256(identity.encode("utf-8", errors="surrogatepass")).hexdigest()[:24]


@dataclass(frozen=True)
class MusicSettings:
    music_folder: str = ""
    library_id: str = ""
    recursive: bool = True

    @property
    def configured(self) -> bool:
        return bool(self.music_folder and self.library_id)

    @classmethod
    def from_folder(cls, folder: Path, installation_id: str, *, recursive: bool = True) -> "MusicSettings":
        resolved = folder.resolve(strict=True)
        return cls(
            music_folder=str(resolved),
            library_id=library_id_for(resolved, installation_id),
            recursive=bool(recursive),
        )

    def public_dict(self) -> dict[str, Any]:
        return {**asdict(self), "configured": self.configured}


class SettingsStore:
    """Thread-safe JSON settings store using same-directory atomic replace."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = (data_dir or default_data_dir()).expanduser().resolve()
        self.path = self.data_dir / "music-settings.json"
        self.installation_id_path = self.data_dir / "installation-id"
        self._lock = threading.RLock()

    def _read_installation_id(self) -> str:
        try:
            value = self.installation_id_path.read_text(encoding="ascii").strip().lower()
        except OSError:
            return ""
        return value if re.fullmatch(r"[0-9a-f]{32}", value) else ""

    def _installation_id(self) -> str:
        existing = self._read_installation_id()
        if existing:
            return existing
        self.data_dir.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_hex(16)
        try:
            with self.installation_id_path.open("x", encoding="ascii") as target:
                target.write(generated + "\n")
        except FileExistsError:
            winner = self._read_installation_id()
            if winner:
                return winner
            temporary = self.installation_id_path.with_suffix(".tmp")
            temporary.write_text(generated + "\n", encoding="ascii")
            os.replace(temporary, self.installation_id_path)
        return generated

    def load(self) -> MusicSettings:
        with self._lock:
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                return MusicSettings()
            raw_folder = payload.get("music_folder", "") if isinstance(payload, dict) else ""
            installation_id = self._read_installation_id()
            if not installation_id:
                # Avoid creating files merely because a Flask app imported.
                return MusicSettings()
            try:
                folder = resolve_music_folder(str(raw_folder))
            except (OSError, ValueError):
                # Do not trust stale or hand-edited identifiers from disk.
                return MusicSettings()
            return MusicSettings.from_folder(
                folder,
                installation_id,
                recursive=payload.get("recursive", True) is not False,
            )

    def set_music_folder(self, value: str | os.PathLike[str], *, recursive: bool = True) -> MusicSettings:
        with self._lock:
            settings = MusicSettings.from_folder(
                resolve_music_folder(value), self._installation_id(), recursive=recursive
            )
            temporary = self.path.with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps(asdict(settings), indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, self.path)
        return settings
