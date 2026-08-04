from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from backend.video.library import Video
from backend.video.progress import MAX_VIDEO_SECONDS, VideoProgress


def make_video(root: Path, video_id: str, *, library_id: str = "library-a") -> Video:
    path = root / f"{video_id}.mp4"
    path.write_bytes(b"video")
    return Video(
        id=video_id,
        library_id=library_id,
        path=path,
        filename=path.name,
        title=f"Title {video_id}",
        folder="(root)",
        duration=90,
        format="MP4",
        mime_type="video/mp4",
        byte_size=5,
        modified_at="2026-01-01T00:00:00+00:00",
    )


class VideoProgressTests(unittest.TestCase):
    def test_record_and_recent_persist_resume_state_with_catalog_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            progress = VideoProgress(root / "progress.sqlite3")
            first = make_video(root, "first")
            second = make_video(root, "second")
            progress.record(
                library_id="library-a",
                video=first,
                position=12.5,
                duration=90,
                now=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
            progress.record(
                library_id="library-a",
                video=second,
                position=90,
                duration=90,
                completed=True,
                now=datetime(2026, 1, 2, tzinfo=timezone.utc),
            )

            items = progress.recent("library-a", {first.id: first, second.id: second})

            self.assertEqual([item["video_id"] for item in items], ["second", "first"])
            self.assertTrue(items[0]["completed"])
            self.assertEqual(items[1]["position"], 12.5)
            self.assertEqual(items[1]["title"], "Title first")
            self.assertEqual(items[1]["stream_url"], "/api/video/stream/first")

    def test_updates_are_clamped_and_stale_catalog_entries_are_hidden(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            progress = VideoProgress(root / "progress.sqlite3")
            video = make_video(root, "video")
            saved = progress.record(
                library_id="library-a",
                video=video,
                position=MAX_VIDEO_SECONDS + 50,
                duration=50,
            )
            self.assertEqual(saved["position"], 50)
            self.assertEqual(progress.recent("library-a", {}), [])

    def test_rejects_wrong_library_and_invalid_values(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            progress = VideoProgress(root / "progress.sqlite3")
            video = make_video(root, "video")
            with self.assertRaises(ValueError):
                progress.record(
                    library_id="library-b", video=video, position=1, duration=10
                )
            for position in (True, "one", float("inf")):
                with self.subTest(position=position), self.assertRaises(ValueError):
                    progress.record(
                        library_id="library-a",
                        video=video,
                        position=position,
                        duration=10,
                    )
            with self.assertRaises(ValueError):
                progress.record(
                    library_id="library-a",
                    video=video,
                    position=1,
                    duration=10,
                    completed="yes",
                )
            with self.assertRaises(ValueError):
                progress.recent("library-a", {video.id: video}, limit=0)


if __name__ == "__main__":
    unittest.main()
