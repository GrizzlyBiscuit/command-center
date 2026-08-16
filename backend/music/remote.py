"""Thread-safe coordination for controlling the host music renderer.

Only opaque catalog track IDs cross this boundary.  The coordinator never
accepts file paths, media URLs, or client-supplied track metadata.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Collection, Mapping
import math
import re
import threading
import time
import uuid
from typing import Any


DEFAULT_LEASE_TTL = 8.0
DEFAULT_COMMAND_TTL = 15.0
MAX_PENDING_COMMANDS = 64
MAX_QUEUE_TRACKS = 2000
MAX_POSITION_SECONDS = 7 * 24 * 60 * 60
REPEAT_MODES = frozenset({"off", "all", "one"})
COMMAND_ACTIONS = frozenset(
    {"load", "play", "pause", "next", "previous", "seek", "volume", "repeat", "shuffle", "stop"}
)
_SAFE_ERROR = re.compile(r"^[\w .,!?'()\-]{0,160}$", re.UNICODE)
_SAFE_EPOCH = re.compile(r"^[A-Za-z0-9-]{0,64}$")


class RemotePlaybackError(ValueError):
    """Base class for expected coordinator failures."""


class RendererOffline(RemotePlaybackError):
    """Raised when a command is sent without an active renderer lease."""


class RendererBusy(RemotePlaybackError):
    """Raised when another renderer owns the active lease."""


class CommandQueueFull(RemotePlaybackError):
    """Raised rather than silently discarding an unacknowledged command."""


class InvalidRemotePayload(RemotePlaybackError):
    """Raised for a malformed or untrusted renderer/command payload."""


def _default_state() -> dict[str, Any]:
    return {
        "queue": [],
        "index": -1,
        "playing": False,
        "position": 0.0,
        "duration": 0.0,
        "volume": 1.0,
        "repeat": "off",
        "shuffle": False,
        "error": "",
    }


class PlaybackCoordinator:
    """Maintain a short renderer lease and an acknowledged command queue."""

    def __init__(
        self,
        catalog_ids: Callable[[], Collection[str]],
        *,
        clock: Callable[[], float] = time.monotonic,
        lease_ttl: float = DEFAULT_LEASE_TTL,
        command_ttl: float = DEFAULT_COMMAND_TTL,
        max_pending: int = MAX_PENDING_COMMANDS,
        max_queue_tracks: int = MAX_QUEUE_TRACKS,
        epoch: str | None = None,
    ) -> None:
        if lease_ttl <= 0 or command_ttl <= 0 or max_pending <= 0 or max_queue_tracks <= 0:
            raise ValueError("remote playback limits must be positive")
        self._catalog_ids = catalog_ids
        self._clock = clock
        self._lease_ttl = float(lease_ttl)
        self._command_ttl = float(command_ttl)
        self._max_pending = int(max_pending)
        self._max_queue_tracks = int(max_queue_tracks)
        self._epoch = str(epoch or uuid.uuid4())
        self._lock = threading.RLock()
        self._renderer_id: str | None = None
        self._lease_deadline = 0.0
        self._state = _default_state()
        self._commands: deque[dict[str, Any]] = deque()
        self._last_command_id = 0
        self._acked_command_id = 0
        self._revision = 0
        self._queue_revision = 0

    @property
    def epoch(self) -> str:
        return self._epoch

    def status(
        self,
        *,
        epoch: str | None = None,
        queue_revision: int | None = None,
    ) -> dict[str, Any]:
        """Return status, omitting the queue only for a matching delta cursor."""
        with self._lock:
            now = self._clock()
            self._expire_locked(now)
            self._prune_commands_locked(now)
            include_queue = not (
                epoch == self._epoch
                and isinstance(queue_revision, int)
                and not isinstance(queue_revision, bool)
                and queue_revision == self._queue_revision
            )
            return self._status_locked(include_queue=include_queue)

    def compact_status(self) -> dict[str, Any]:
        """Return status without the potentially large playback queue."""
        with self._lock:
            now = self._clock()
            self._expire_locked(now)
            self._prune_commands_locked(now)
            return self._status_locked(include_queue=False)

    def enqueue(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Validate and enqueue one LAN-originated renderer command."""
        with self._lock:
            now = self._clock()
            self._expire_locked(now)
            self._prune_commands_locked(now)
            if self._renderer_id is None:
                raise RendererOffline("PC playback is offline")
            if len(self._commands) >= self._max_pending:
                raise CommandQueueFull("PC playback command queue is full")
            command = self._validate_command(payload)
            self._last_command_id += 1
            command = {
                "id": self._last_command_id,
                **command,
                "_expires_at": now + self._command_ttl,
            }
            self._commands.append(command)
            self._revision += 1
            return {
                "accepted": True,
                "command_id": self._last_command_id,
                **self._status_locked(include_queue=False),
            }

    def renderer_heartbeat(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Renew/claim the renderer lease, acknowledge, and poll commands."""
        # ``epoch`` is echoed by the browser so it can reset its acknowledgement
        # cursor after a server restart.  Server state remains authoritative.
        self._require_keys(payload, {"renderer_id", "epoch", "ack", "state"}, "renderer")
        renderer_id = self._renderer_uuid(payload.get("renderer_id"))
        supplied_epoch = payload.get("epoch", "")
        if not isinstance(supplied_epoch, str) or not _SAFE_EPOCH.fullmatch(supplied_epoch):
            raise InvalidRemotePayload("epoch is invalid")
        ack = self._integer(payload.get("ack"), "ack", minimum=0)
        state_payload = payload.get("state")
        if not isinstance(state_payload, Mapping):
            raise InvalidRemotePayload("state must be an object")

        with self._lock:
            now = self._clock()
            self._expire_locked(now)
            self._prune_commands_locked(now)
            new_lease = self._renderer_id is None
            if not new_lease and self._renderer_id != renderer_id:
                raise RendererBusy("another PC renderer owns the active lease")

            if not new_lease:
                if ack < self._acked_command_id:
                    raise InvalidRemotePayload("ack must not move backwards")
                if ack > self._last_command_id:
                    raise InvalidRemotePayload("ack exceeds the latest command")

            previous_state = _default_state() if new_lease else self._state
            state = self._validate_state(state_payload, previous_state)

            if new_lease:
                # Commands belong to a particular live lease.  A renderer that
                # returns after expiry, even with the same UUID, starts clean.
                self._commands.clear()
                self._renderer_id = renderer_id
                self._acked_command_id = self._last_command_id
                self._state = _default_state()
                self._revision += 1
            else:
                if ack > self._acked_command_id:
                    self._acked_command_id = ack
                    removed = False
                    while self._commands and self._commands[0]["id"] <= ack:
                        self._commands.popleft()
                        removed = True
                    if removed:
                        self._revision += 1

            if state != self._state:
                if state["queue"] != self._state["queue"]:
                    self._queue_revision += 1
                self._state = state
                self._revision += 1
            self._lease_deadline = now + self._lease_ttl
            result = self._status_locked(include_queue=False)
            result.update(
                {
                    "renderer": True,
                    "lease_claimed": new_lease,
                    "ack": self._acked_command_id,
                    "commands": [self._public_command(item) for item in self._commands],
                }
            )
            return result

    def _status_locked(self, *, include_queue: bool) -> dict[str, Any]:
        state = dict(self._state)
        if include_queue:
            state["queue"] = list(self._state["queue"])
        else:
            state.pop("queue", None)
        return {
            "epoch": self._epoch,
            "renderer_online": self._renderer_id is not None,
            "revision": self._revision,
            "queue_revision": self._queue_revision,
            "ack": self._acked_command_id,
            "state": state,
        }

    def _expire_locked(self, now: float) -> None:
        if self._renderer_id is not None and now >= self._lease_deadline:
            self._renderer_id = None
            self._lease_deadline = 0.0
            self._commands.clear()
            self._acked_command_id = self._last_command_id
            if self._state["queue"]:
                self._queue_revision += 1
            self._state = _default_state()
            self._revision += 1

    def _prune_commands_locked(self, now: float) -> None:
        if not self._commands:
            return
        before = len(self._commands)
        self._commands = deque(item for item in self._commands if item["_expires_at"] > now)
        if len(self._commands) != before:
            self._revision += 1

    @staticmethod
    def _public_command(command: Mapping[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in command.items() if not key.startswith("_")}

    def _validate_command(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise InvalidRemotePayload("command must be an object")
        action_value = payload.get("action")
        if not isinstance(action_value, str):
            raise InvalidRemotePayload("action must be a string")
        action = action_value.strip().lower()
        if action not in COMMAND_ACTIONS:
            raise InvalidRemotePayload("unsupported playback action")

        if action == "load":
            allowed = {"action", "queue", "index", "autoplay", "position", "repeat", "shuffle"}
            self._require_keys(payload, allowed, "command")
            queue = self._validated_command_queue(payload.get("queue"), require_nonempty=True)
            index = self._integer(payload.get("index", 0), "index")
            index = min(max(index, 0), len(queue) - 1)
            command: dict[str, Any] = {
                "action": action,
                "queue": queue,
                "index": index,
                "autoplay": self._boolean(payload.get("autoplay", True), "autoplay"),
            }
            if "position" in payload:
                command["position"] = self._finite(payload["position"], "position", 0, MAX_POSITION_SECONDS)
            if "repeat" in payload:
                command["repeat"] = self._repeat(payload["repeat"])
            if "shuffle" in payload:
                command["shuffle"] = self._boolean(payload["shuffle"], "shuffle")
            return command

        fields: dict[str, set[str]] = {
            "play": {"action"},
            "pause": {"action"},
            "next": {"action"},
            "previous": {"action"},
            "stop": {"action"},
            "seek": {"action", "position"},
            "volume": {"action", "volume"},
            "repeat": {"action", "mode"},
            "shuffle": {"action", "enabled"},
        }
        self._require_keys(payload, fields[action], "command")
        command = {"action": action}
        if action == "seek":
            if "position" not in payload:
                raise InvalidRemotePayload("position is required")
            command["position"] = self._finite(payload["position"], "position", 0, MAX_POSITION_SECONDS)
        elif action == "volume":
            if "volume" not in payload:
                raise InvalidRemotePayload("volume is required")
            command["volume"] = self._finite(payload["volume"], "volume", 0, 1)
        elif action == "repeat":
            if "mode" not in payload:
                raise InvalidRemotePayload("mode is required")
            command["mode"] = self._repeat(payload["mode"])
        elif action == "shuffle":
            if "enabled" not in payload:
                raise InvalidRemotePayload("enabled is required")
            command["enabled"] = self._boolean(payload["enabled"], "enabled")
        return command

    def _validate_state(
        self,
        payload: Mapping[str, Any],
        previous: Mapping[str, Any],
    ) -> dict[str, Any]:
        allowed = {
            "queue",
            "index",
            "queue_index",
            "playing",
            "position",
            "duration",
            "volume",
            "repeat",
            "shuffle",
            "error",
        }
        self._require_keys(payload, allowed, "state")
        source_queue = payload.get("queue", previous["queue"])
        raw_index = payload.get("index", payload.get("queue_index", previous["index"]))
        if "index" in payload and "queue_index" in payload and payload["index"] != payload["queue_index"]:
            raise InvalidRemotePayload("index and queue_index disagree")
        original_index = self._integer(raw_index, "index")
        # Resolve one immutable snapshot-backed ID collection for the whole
        # state validation.  Unknown IDs can be normal scan churn, so renderer
        # reports drop them rather than taking the PC renderer offline.
        catalog_ids = self._catalog_ids()
        queue, index = self._validated_renderer_queue(
            source_queue,
            original_index,
            catalog_ids,
        )
        duration = self._finite(payload.get("duration", 0), "duration", 0, MAX_POSITION_SECONDS)
        position_limit = duration if duration > 0 else MAX_POSITION_SECONDS
        error = payload.get("error", "")
        if error is None:
            error = ""
        if not isinstance(error, str) or not _SAFE_ERROR.fullmatch(error):
            raise InvalidRemotePayload("error must be a short safe message")
        return {
            "queue": queue,
            "index": index,
            "playing": self._boolean(payload.get("playing", False), "playing"),
            "position": self._finite(payload.get("position", 0), "position", 0, position_limit),
            "duration": duration,
            "volume": self._finite(payload.get("volume", 1), "volume", 0, 1),
            "repeat": self._repeat(payload.get("repeat", "off")),
            "shuffle": self._boolean(payload.get("shuffle", False), "shuffle"),
            "error": error,
        }

    def _validated_command_queue(self, value: Any, *, require_nonempty: bool = False) -> list[str]:
        catalog_ids = self._catalog_ids()
        if not isinstance(value, list):
            raise InvalidRemotePayload("queue must be an array")
        if require_nonempty and not value:
            raise InvalidRemotePayload("queue must contain at least one track")
        if len(value) > self._max_queue_tracks:
            raise InvalidRemotePayload(f"queue cannot exceed {self._max_queue_tracks} tracks")
        queue: list[str] = []
        for item in value:
            if not isinstance(item, str) or not item or len(item) > 128:
                raise InvalidRemotePayload("queue contains an invalid track ID")
            if item not in catalog_ids:
                raise InvalidRemotePayload("queue contains an unknown track ID")
            queue.append(item)
        return queue

    def _validated_renderer_queue(
        self,
        value: Any,
        original_index: int,
        catalog_ids: Collection[str],
    ) -> tuple[list[str], int]:
        if not isinstance(value, list):
            raise InvalidRemotePayload("queue must be an array")
        if len(value) > self._max_queue_tracks:
            raise InvalidRemotePayload(f"queue cannot exceed {self._max_queue_tracks} tracks")
        selected_position = -1
        if value and original_index >= 0:
            selected_position = min(original_index, len(value) - 1)
        queue: list[str] = []
        remapped_index = -1
        for position, item in enumerate(value):
            if not isinstance(item, str) or not item or len(item) > 128:
                raise InvalidRemotePayload("queue contains an invalid track ID")
            if item not in catalog_ids:
                continue
            if position == selected_position:
                remapped_index = len(queue)
            queue.append(item)
        return queue, remapped_index

    @staticmethod
    def _renderer_uuid(value: Any) -> str:
        if not isinstance(value, str):
            raise InvalidRemotePayload("renderer_id must be a UUID")
        try:
            parsed = uuid.UUID(value)
        except (ValueError, AttributeError):
            raise InvalidRemotePayload("renderer_id must be a UUID") from None
        return str(parsed)

    @staticmethod
    def _integer(value: Any, name: str, *, minimum: int | None = None) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise InvalidRemotePayload(f"{name} must be an integer")
        if minimum is not None and value < minimum:
            raise InvalidRemotePayload(f"{name} must be at least {minimum}")
        return value

    @staticmethod
    def _finite(value: Any, name: str, minimum: float, maximum: float) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise InvalidRemotePayload(f"{name} must be a finite number")
        return min(max(float(value), minimum), maximum)

    @staticmethod
    def _boolean(value: Any, name: str) -> bool:
        if not isinstance(value, bool):
            raise InvalidRemotePayload(f"{name} must be a boolean")
        return value

    @staticmethod
    def _repeat(value: Any) -> str:
        if not isinstance(value, str) or value not in REPEAT_MODES:
            raise InvalidRemotePayload("repeat must be off, all, or one")
        return value

    @staticmethod
    def _require_keys(payload: Mapping[str, Any], allowed: set[str], label: str) -> None:
        unexpected = set(payload) - allowed
        if unexpected:
            raise InvalidRemotePayload(f"{label} contains unsupported fields")
