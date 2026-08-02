"""SQLite-backed resume positions and recently watched videos."""

from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import math
from pathlib import Path
import sqlite3
import threading
from typing import Any, Mapping

from .library import Video


MAX_VIDEO_SECONDS = 7 * 24 * 60 * 60
MAX_RECENT_ITEMS = 100


class VideoProgress:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._lock = threading.RLock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with closing(self._connect()) as db, db:
                db.execute("PRAGMA journal_mode = WAL")
                db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS video_progress (
                        library_id TEXT NOT NULL,
                        video_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        position REAL NOT NULL DEFAULT 0,
                        duration REAL NOT NULL DEFAULT 0,
                        completed INTEGER NOT NULL DEFAULT 0,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (library_id, video_id)
                    )
                    """
                )
                db.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_video_progress_recent
                    ON video_progress (library_id, updated_at DESC)
                    """
                )
            self._initialized = True

    @staticmethod
    def _seconds(value: object, name: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{name} must be numeric")
        number = float(value)
        if not math.isfinite(number):
            raise ValueError(f"{name} must be finite")
        return min(max(number, 0.0), MAX_VIDEO_SECONDS)

    def record(
        self,
        *,
        library_id: str,
        video: Video,
        position: object,
        duration: object,
        completed: object = False,
        now: datetime | None = None,
    ) -> dict[str, object]:
        self._initialize()
        if video.library_id != library_id:
            raise ValueError("video does not belong to this library")
        if not isinstance(completed, bool):
            raise ValueError("completed must be a boolean")
        safe_duration = self._seconds(duration, "duration")
        safe_position = self._seconds(position, "position")
        if safe_duration > 0:
            safe_position = min(safe_position, safe_duration)
        timestamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(
            timespec="microseconds"
        )
        with self._lock, closing(self._connect()) as db, db:
            db.execute(
                """
                INSERT INTO video_progress
                    (library_id, video_id, title, position, duration, completed, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(library_id, video_id) DO UPDATE SET
                    title=excluded.title,
                    position=excluded.position,
                    duration=excluded.duration,
                    completed=excluded.completed,
                    updated_at=excluded.updated_at
                """,
                (
                    library_id,
                    video.id,
                    video.title,
                    safe_position,
                    safe_duration,
                    int(completed),
                    timestamp,
                ),
            )
        return self._public_item(
            video,
            position=safe_position,
            duration=safe_duration,
            completed=completed,
            updated_at=timestamp,
        )

    def recent(
        self,
        library_id: str,
        videos_by_id: Mapping[str, Video],
        *,
        limit: int = 20,
    ) -> list[dict[str, object]]:
        self._initialize()
        if (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or not 1 <= limit <= MAX_RECENT_ITEMS
        ):
            raise ValueError(f"limit must be between 1 and {MAX_RECENT_ITEMS}")
        # Read the namespace in recency order, then omit entries removed by a rescan.
        with self._lock, closing(self._connect()) as db:
            rows = db.execute(
                """
                SELECT video_id, position, duration, completed, updated_at
                FROM video_progress
                WHERE library_id = ?
                ORDER BY updated_at DESC, video_id ASC
                """,
                (library_id,),
            ).fetchall()
        items: list[dict[str, object]] = []
        for row in rows:
            video = videos_by_id.get(row["video_id"])
            if video is None:
                continue
            items.append(
                self._public_item(
                    video,
                    position=float(row["position"] or 0),
                    duration=float(row["duration"] or 0),
                    completed=bool(row["completed"]),
                    updated_at=str(row["updated_at"]),
                )
            )
            if len(items) >= limit:
                break
        return items

    @staticmethod
    def _public_item(
        video: Video,
        *,
        position: float,
        duration: float,
        completed: bool,
        updated_at: str,
    ) -> dict[str, object]:
        return {
            "video_id": video.id,
            "title": video.title,
            "folder": video.folder,
            "position": round(position, 3),
            "duration": round(duration or video.duration, 3),
            "completed": completed,
            "updated_at": updated_at,
            "stream_url": f"/api/video/stream/{video.id}",
        }
