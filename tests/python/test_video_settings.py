from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from backend.video.settings import SettingsStore, library_id_for, resolve_video_folder


class VideoSettingsTests(unittest.TestCase):
    def test_settings_are_separate_atomic_and_namespaced(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            videos = root / "My Videos"
            videos.mkdir()
            store = SettingsStore(root / "data")

            saved = store.set_video_folder(videos, recursive=False)

            installation_id = store.installation_id_path.read_text(encoding="ascii").strip()
            self.assertEqual(saved.library_id, library_id_for(videos, installation_id))
            self.assertEqual(store.load(), saved)
            self.assertFalse(saved.recursive)
            self.assertEqual(store.path.name, "video-settings.json")
            self.assertFalse(store.path.with_suffix(".json.tmp").exists())
            self.assertEqual(
                json.loads(store.path.read_text(encoding="utf-8"))["video_folder"],
                str(videos.resolve()),
            )

    def test_load_recomputes_tampered_id_and_rejects_stale_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            videos = root / "videos"
            videos.mkdir()
            store = SettingsStore(root / "data")
            store.data_dir.mkdir()
            store.installation_id_path.write_text("a" * 32 + "\n", encoding="ascii")
            store.path.write_text(
                json.dumps({"video_folder": str(videos), "library_id": "client-value"}),
                encoding="utf-8",
            )
            self.assertEqual(store.load().library_id, library_id_for(videos, "a" * 32))
            videos.rmdir()
            self.assertFalse(store.load().configured)

    def test_folder_must_exist_and_be_a_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            regular_file = root / "movie.mp4"
            regular_file.write_bytes(b"video")
            with self.assertRaises(ValueError):
                resolve_video_folder(regular_file)
            with self.assertRaises((OSError, ValueError)):
                resolve_video_folder(root / "missing")


if __name__ == "__main__":
    unittest.main()
