"""Compact SQLite listening summaries keyed to a library namespace.

Adapted in part from Taeyeon Media Player (MIT); see the package license.
Unlike the original browser-facing recorder, this implementation only accepts
an opaque track ID.  Display metadata is supplied by the server-side catalog.
"""

from __future__ import annotations

from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import threading
from typing import Any

from .library import Track


MAX_EVENT_ID_LENGTH = 128
MAX_SECONDS_PER_EVENT = 300.0


class ListeningStats:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._lock = threading.RLock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with closing(self._connect()) as db, db:
                self._create_schema(db)
            self._initialized = True

    def _create_schema(self, db: sqlite3.Connection) -> None:
        db.execute("PRAGMA journal_mode = WAL")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS music_track_stats (
                library_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                play_count INTEGER NOT NULL DEFAULT 0,
                total_seconds REAL NOT NULL DEFAULT 0,
                last_played TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (library_id, track_id)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS music_daily_stats (
                library_id TEXT NOT NULL,
                day TEXT NOT NULL,
                track_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                play_count INTEGER NOT NULL DEFAULT 0,
                seconds REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (library_id, day, track_id)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS music_event_receipts (
                library_id TEXT NOT NULL,
                client_event_id TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                PRIMARY KEY (library_id, client_event_id)
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_music_event_receipts_recorded_at
            ON music_event_receipts (recorded_at)
            """
        )

    def record(
        self,
        *,
        library_id: str,
        track: Track,
        client_event_id: str,
        seconds: object = 0,
        count_play: object = False,
        now: datetime | None = None,
    ) -> dict[str, object]:
        """Record one idempotent event using trusted catalog metadata."""
        self._initialize()
        event_id = str(client_event_id or "").strip()
        if not event_id:
            raise ValueError("client_event_id is required")
        if len(event_id) > MAX_EVENT_ID_LENGTH:
            raise ValueError("client_event_id is too long")
        if track.library_id != library_id:
            raise ValueError("track does not belong to this library")
        try:
            listened = max(0.0, min(float(seconds or 0), MAX_SECONDS_PER_EVENT))
        except (TypeError, ValueError, OverflowError):
            raise ValueError("seconds must be numeric") from None
        played = 1 if count_play is True else 0
        if listened <= 0 and not played:
            return {"ok": True, "ignored": True, "track_id": track.id}

        moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        timestamp = moment.isoformat(timespec="seconds")
        day = moment.date().isoformat()
        last_played = timestamp if played else ""
        with self._lock, closing(self._connect()) as db, db:
            receipt = db.execute(
                """
                INSERT OR IGNORE INTO music_event_receipts
                    (library_id, client_event_id, recorded_at)
                VALUES (?, ?, ?)
                """,
                (library_id, event_id, timestamp),
            )
            if receipt.rowcount == 0:
                return {"ok": True, "duplicate": True, "track_id": track.id}
            db.execute(
                """
                INSERT INTO music_track_stats
                    (library_id, track_id, title, artist, album, play_count, total_seconds, last_played)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(library_id, track_id) DO UPDATE SET
                    title=excluded.title,
                    artist=excluded.artist,
                    album=excluded.album,
                    play_count=music_track_stats.play_count + excluded.play_count,
                    total_seconds=music_track_stats.total_seconds + excluded.total_seconds,
                    last_played=CASE WHEN excluded.last_played = ''
                        THEN music_track_stats.last_played ELSE excluded.last_played END
                """,
                (
                    library_id,
                    track.id,
                    track.title,
                    track.artist,
                    track.album,
                    played,
                    listened,
                    last_played,
                ),
            )
            db.execute(
                """
                INSERT INTO music_daily_stats
                    (library_id, day, track_id, title, artist, album, play_count, seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(library_id, day, track_id) DO UPDATE SET
                    title=excluded.title,
                    artist=excluded.artist,
                    album=excluded.album,
                    play_count=music_daily_stats.play_count + excluded.play_count,
                    seconds=music_daily_stats.seconds + excluded.seconds
                """,
                (library_id, day, track.id, track.title, track.artist, track.album, played, listened),
            )
            cutoff = (moment - timedelta(days=45)).isoformat(timespec="seconds")
            db.execute("DELETE FROM music_event_receipts WHERE recorded_at < ?", (cutoff,))
        return {"ok": True, "track_id": track.id}

    def summary(
        self,
        library_id: str,
        days: int | None = 30,
        *,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Return totals, daily chart data, and top tracks for one library."""
        self._initialize()
        if days is not None:
            if not isinstance(days, int) or not 1 <= days <= 366:
                raise ValueError("days must be between 1 and 366, or omitted for all time")
            moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
            start = (moment.date() - timedelta(days=days - 1)).isoformat()
        else:
            start = None
        with self._lock, closing(self._connect()) as db:
            if start:
                rows = db.execute(
                    """
                    SELECT day, track_id, title, artist, album, play_count, seconds
                    FROM music_daily_stats
                    WHERE library_id = ? AND day >= ?
                    ORDER BY day ASC, seconds DESC
                    """,
                    (library_id, start),
                ).fetchall()
            else:
                rows = db.execute(
                    """
                    SELECT day, track_id, title, artist, album, play_count, seconds
                    FROM music_daily_stats
                    WHERE library_id = ?
                    ORDER BY day ASC, seconds DESC
                    """,
                    (library_id,),
                ).fetchall()

        daily: dict[str, dict[str, object]] = {}
        tracks: dict[str, dict[str, object]] = {}
        for row in rows:
            day_entry = daily.setdefault(row["day"], {"day": row["day"], "seconds": 0.0, "play_count": 0})
            day_entry["seconds"] = float(day_entry["seconds"]) + float(row["seconds"] or 0)
            day_entry["play_count"] = int(day_entry["play_count"]) + int(row["play_count"] or 0)
            item = tracks.setdefault(
                row["track_id"],
                {
                    "track_id": row["track_id"],
                    "title": row["title"],
                    "artist": row["artist"],
                    "album": row["album"],
                    "seconds": 0.0,
                    "play_count": 0,
                },
            )
            item["seconds"] = float(item["seconds"]) + float(row["seconds"] or 0)
            item["play_count"] = int(item["play_count"]) + int(row["play_count"] or 0)

        top_tracks = sorted(
            tracks.values(), key=lambda item: (float(item["seconds"]), int(item["play_count"])), reverse=True
        )[:10]
        return {
            "library_id": library_id,
            "days": days,
            "summary": {
                "seconds": sum(float(item["seconds"]) for item in daily.values()),
                "play_count": sum(int(item["play_count"]) for item in daily.values()),
                "unique_tracks": len(tracks),
                "listening_days": len(daily),
            },
            "daily": list(daily.values()),
            "top_tracks": top_tracks,
        }
