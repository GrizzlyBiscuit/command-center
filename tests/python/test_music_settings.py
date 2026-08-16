from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from backend.music.settings import SettingsStore, library_id_for, resolve_music_folder


class MusicSettingsTests(unittest.TestCase):
    def test_settings_are_atomic_and_recompute_the_library_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            music = root / "My Music"
            music.mkdir()
            store = SettingsStore(root / "user-data")

            saved = store.set_music_folder(str(music))

            installation_id = store.installation_id_path.read_text(encoding="ascii").strip()
            self.assertEqual(saved.library_id, library_id_for(music, installation_id))
            self.assertEqual(store.load(), saved)
            self.assertFalse(store.path.with_suffix(".json.tmp").exists())
            on_disk = json.loads(store.path.read_text(encoding="utf-8"))
            self.assertEqual(on_disk["library_id"], saved.library_id)

    def test_load_ignores_tampered_identifier_and_stale_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            music = root / "music"
            music.mkdir()
            store = SettingsStore(root / "data")
            store.data_dir.mkdir()
            store.installation_id_path.write_text("a" * 32 + "\n", encoding="ascii")
            store.path.write_text(
                json.dumps({"music_folder": str(music), "library_id": "attacker-controlled"}), encoding="utf-8"
            )
            self.assertEqual(store.load().library_id, library_id_for(music, "a" * 32))
            music.rmdir()
            self.assertFalse(store.load().configured)

    def test_folder_must_exist_and_be_a_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            regular_file = root / "song.mp3"
            regular_file.write_bytes(b"not music")
            with self.assertRaises(ValueError):
                resolve_music_folder(regular_file)
            with self.assertRaises((OSError, ValueError)):
                resolve_music_folder(root / "missing")

    def test_same_root_has_different_ids_for_different_installations(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            music = root / "music"
            music.mkdir()
            first = SettingsStore(root / "profile-one").set_music_folder(music)
            second = SettingsStore(root / "profile-two").set_music_folder(music)
            self.assertNotEqual(first.library_id, second.library_id)


if __name__ == "__main__":
    unittest.main()
