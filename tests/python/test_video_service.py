from __future__ import annotations

from pathlib import Path
import sqlite3
import tempfile
import unittest

from backend.video import VideoService


class VideoServiceTests(unittest.TestCase):
    def test_construction_and_empty_catalog_do_not_create_user_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary) / "new-user-data"
            service = VideoService(data_dir)
            self.assertFalse(data_dir.exists())
            self.assertFalse(service.settings.configured)

            catalog = service.catalog()
            progress = service.progress_payload()

            self.assertEqual(catalog["videos"], [])
            self.assertEqual(catalog["recent"], [])
            self.assertEqual(progress["items"], [])
            self.assertFalse(data_dir.exists())

    def test_catalog_survives_unavailable_optional_progress_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            videos = root / "videos"
            videos.mkdir()
            (videos / "Night Sky.mp4").write_bytes(b"video")
            service = VideoService(root / "data")
            service.configure_folder(str(videos), scan=False)
            service.library.scan_now(service.settings)

            def unavailable(*_args: object, **_kwargs: object) -> list[dict[str, object]]:
                raise sqlite3.OperationalError("unable to open database file")

            service.progress.recent = unavailable  # type: ignore[method-assign]

            catalog = service.catalog()
            progress = service.progress_payload()

            self.assertEqual(catalog["count"], 1)
            self.assertEqual(catalog["videos"][0]["title"], "Night Sky")
            self.assertEqual(catalog["recent"], [])
            self.assertEqual(progress["items"], [])


if __name__ == "__main__":
    unittest.main()
