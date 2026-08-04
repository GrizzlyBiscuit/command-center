from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from backend.music import MusicService


class MusicServiceTests(unittest.TestCase):
    def test_construction_does_not_create_settings_cache_or_sqlite_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary) / "new-user-data"
            service = MusicService(data_dir)
            self.assertFalse(data_dir.exists())
            self.assertFalse(service.settings.configured)


if __name__ == "__main__":
    unittest.main()
