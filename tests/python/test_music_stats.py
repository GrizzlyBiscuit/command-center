from __future__ import annotations

from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import tempfile
import unittest

from backend.music.library import Track
from backend.music.stats import ListeningStats


def track(library_id: str, track_id: str = "track-one") -> Track:
    return Track(
        id=track_id,
        library_id=library_id,
        path=Path("unused.mp3"),
        filename="unused.mp3",
        title="Trusted title",
        artist="Trusted artist",
        album="Trusted album",
        album_artist="",
        genre="",
        date="",
        track_number="",
        duration=120,
        format="MP3",
        mime_type="audio/mpeg",
        byte_size=100,
        bitrate_kbps=0,
        sample_rate_hz=0,
        bit_depth=0,
        has_artwork=False,
    )


class MusicStatsTests(unittest.TestCase):
    def test_record_is_idempotent_and_uses_server_track_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stats = ListeningStats(Path(temporary) / "stats.sqlite3")
            item = track("library-a")
            now = datetime(2026, 8, 2, 12, tzinfo=timezone.utc)
            first = stats.record(
                library_id="library-a",
                track=item,
                client_event_id="event-1",
                seconds=15,
                count_play=True,
                now=now,
            )
            duplicate = stats.record(
                library_id="library-a",
                track=item,
                client_event_id="event-1",
                seconds=99,
                count_play=True,
                now=now,
            )
            payload = stats.summary("library-a", None)

            self.assertTrue(first["ok"])
            self.assertTrue(duplicate["duplicate"])
            self.assertEqual(payload["summary"]["seconds"], 15)
            self.assertEqual(payload["summary"]["play_count"], 1)
            self.assertEqual(payload["top_tracks"][0]["title"], "Trusted title")

    def test_event_ids_and_summaries_are_namespaced_by_library(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stats = ListeningStats(Path(temporary) / "stats.sqlite3")
            now = datetime.now(timezone.utc)
            stats.record(
                library_id="library-a", track=track("library-a"), client_event_id="same-id", seconds=3, now=now
            )
            stats.record(
                library_id="library-b", track=track("library-b"), client_event_id="same-id", seconds=7, now=now
            )
            self.assertEqual(stats.summary("library-a", None)["summary"]["seconds"], 3)
            self.assertEqual(stats.summary("library-b", None)["summary"]["seconds"], 7)

    def test_metadata_cannot_be_recorded_for_another_library(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stats = ListeningStats(Path(temporary) / "stats.sqlite3")
            with self.assertRaises(ValueError):
                stats.record(
                    library_id="library-b",
                    track=track("library-a"),
                    client_event_id="event",
                    seconds=1,
                )

    def test_event_receipts_have_recorded_at_cleanup_index(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            db_path = Path(temporary) / "stats.sqlite3"
            stats = ListeningStats(db_path)
            stats.record(
                library_id="library-a",
                track=track("library-a"),
                client_event_id="event",
                seconds=1,
            )

            with closing(sqlite3.connect(db_path)) as db:
                columns = db.execute(
                    "PRAGMA index_info(idx_music_event_receipts_recorded_at)"
                ).fetchall()
            self.assertEqual([column[2] for column in columns], ["recorded_at"])

    def test_summary_window_uses_the_utc_calendar_day(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stats = ListeningStats(Path(temporary) / "stats.sqlite3")
            stats.record(
                library_id="library-a",
                track=track("library-a"),
                client_event_id="before-utc-midnight",
                seconds=1,
                now=datetime(2026, 8, 1, 23, 30, tzinfo=timezone.utc),
            )
            stats.record(
                library_id="library-a",
                track=track("library-a"),
                client_event_id="after-utc-midnight",
                seconds=2,
                now=datetime(2026, 8, 2, 0, 30, tzinfo=timezone.utc),
            )

            local_evening = datetime(
                2026, 8, 1, 17, 30, tzinfo=timezone(-timedelta(hours=7))
            )
            payload = stats.summary("library-a", 1, now=local_evening)

            self.assertEqual(payload["summary"]["seconds"], 2)
            self.assertEqual([item["day"] for item in payload["daily"]], ["2026-08-02"])


if __name__ == "__main__":
    unittest.main()
