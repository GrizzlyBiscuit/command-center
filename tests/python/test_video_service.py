from __future__ import annotations

from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
