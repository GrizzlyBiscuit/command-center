"""Remote video playback coordination.

Video deliberately reuses the already hardened, framework-neutral playback
coordinator used by music.  Its queue contains only catalog-validated opaque
video IDs; paths and client-supplied media URLs never enter the protocol.
"""

from __future__ import annotations

if __package__.startswith("backend."):  # Tests import through the repository root.
    from backend.music.remote import (
        CommandQueueFull,
        InvalidRemotePayload,
        PlaybackCoordinator as _PlaybackCoordinator,
        RemotePlaybackError,
        RendererBusy,
        RendererOffline,
    )
else:  # Command Center runs ``backend`` as the import root in production.
    from music.remote import (  # type: ignore[import-not-found]
        CommandQueueFull,
        InvalidRemotePayload,
        PlaybackCoordinator as _PlaybackCoordinator,
        RemotePlaybackError,
        RendererBusy,
        RendererOffline,
    )


class PlaybackCoordinator(_PlaybackCoordinator):
    """Music-compatible coordinator whose validated queue holds video IDs."""


__all__ = [
    "CommandQueueFull",
    "InvalidRemotePayload",
    "PlaybackCoordinator",
    "RemotePlaybackError",
    "RendererBusy",
    "RendererOffline",
]
