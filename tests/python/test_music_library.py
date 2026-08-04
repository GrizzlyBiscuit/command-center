from __future__ import annotations

from pathlib import Path
import tempfile
import threading
import unittest

from backend.music.library import MusicLibrary, stable_track_id
from backend.music.metadata import Artwork
from backend.music.settings import MusicSettings


class MusicLibraryTests(unittest.TestCase):
    def make_settings(self, root: Path) -> MusicSettings:
        return MusicSettings.from_folder(root, "0123456789abcdef0123456789abcdef")

    def test_recursive_scan_is_music_only_and_does_not_expose_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            album = root / "Artist" / "Album"
            album.mkdir(parents=True)
            (album / "one.mp3").write_bytes(b"audio one")
            (album / "two.flac").write_bytes(b"audio two")
            (album / "interview.txt").write_text("no interviews", encoding="utf-8")
            (album / "video.mp4").write_bytes(b"no video")
            library = MusicLibrary(
                metadata_reader=lambda path: {
                    "title": f"Tagged {path.stem}",
                    "artist": "The Artist",
                    "album": "The Album",
                    "duration": 12.5,
                },
                artwork_reader=lambda path: Artwork(b"cover", "image/jpeg") if path.suffix == ".mp3" else None,
            )

            status = library.scan_now(self.make_settings(root))
            payload = library.snapshot().public_dict()

            self.assertEqual(status.state, "complete")
            self.assertEqual(payload["count"], 2)
            self.assertEqual({track["format"] for track in payload["tracks"]}, {"MP3", "FLAC"})
            self.assertNotIn("path", payload["tracks"][0])
            self.assertNotIn("filename", payload["tracks"][0])
            self.assertTrue(all(len(track["id"]) == 32 for track in payload["tracks"]))
            mp3 = next(track for track in payload["tracks"] if track["format"] == "MP3")
            self.assertIsNotNone(library.artwork_for(mp3["id"]))

    def test_identical_artwork_is_content_addressed_once(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "one.mp3").write_bytes(b"one")
            (root / "two.mp3").write_bytes(b"two")
            cache = root / ".cache"
            library = MusicLibrary(
                metadata_reader=lambda path: {"title": path.stem},
                artwork_reader=lambda _path: Artwork(b"same embedded cover", "image/jpeg"),
                artwork_cache_dir=cache,
            )
            library.scan_now(self.make_settings(root))
            values = list(library.snapshot().artwork_by_id.values())
            self.assertEqual(len(values), 2)
            self.assertIs(values[0], values[1])
            self.assertEqual(len(list(cache.glob("*.jpg"))), 1)
            self.assertEqual(len(list(cache.glob("*.tmp"))), 0)

    def test_artwork_cache_failure_keeps_track_without_broken_art_url(self) -> None:
        class FailingArtworkLibrary(MusicLibrary):
            def _cache_artwork(self, digest: str, artwork: Artwork):
                raise OSError("simulated cache failure")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "song.mp3").write_bytes(b"audio")
            library = FailingArtworkLibrary(
                metadata_reader=lambda _path: {},
                artwork_reader=lambda _path: Artwork(b"cover", "image/jpeg"),
                artwork_cache_dir=root / "cache",
            )
            status = library.scan_now(self.make_settings(root))
            self.assertEqual(status.state, "complete")
            self.assertEqual(len(library.snapshot().tracks), 1)
            track = library.snapshot().tracks[0]
            self.assertFalse(track.has_artwork)
            self.assertIsNone(library.artwork_for(track.id))

    def test_track_id_is_stable_but_namespaced_by_library(self) -> None:
        relative = Path("Artist") / "song.mp3"
        self.assertEqual(stable_track_id("library-a", relative), stable_track_id("library-a", relative))
        self.assertNotEqual(stable_track_id("library-a", relative), stable_track_id("library-b", relative))

    def test_snapshot_is_not_replaced_until_scan_finishes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first.mp3"
            first.write_bytes(b"one")
            gate = threading.Event()
            release = threading.Event()
            blocked = False

            def metadata(path: Path) -> dict[str, str]:
                nonlocal blocked
                if blocked:
                    gate.set()
                    release.wait(3)
                return {"title": path.stem}

            library = MusicLibrary(metadata_reader=metadata, artwork_reader=lambda _path: None)
            settings = self.make_settings(root)
            library.scan_now(settings)
            original = library.snapshot()
            (root / "second.mp3").write_bytes(b"two")
            blocked = True
            library.start_scan(settings)
            self.assertTrue(gate.wait(2))
            self.assertIs(library.snapshot(), original)
            self.assertEqual(len(library.snapshot().tracks), 1)
            release.set()
            for _ in range(100):
                if not library.status().running:
                    break
                threading.Event().wait(0.01)
            self.assertEqual(len(library.snapshot().tracks), 2)

    def test_lookup_accepts_only_catalog_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            song = root / "track.mp3"
            song.write_bytes(b"music")
            library = MusicLibrary(metadata_reader=lambda _path: {}, artwork_reader=lambda _path: None)
            library.scan_now(self.make_settings(root))
            track = library.snapshot().tracks[0]
            self.assertEqual(library.resolve_track(track.id), track)
            self.assertIsNone(library.resolve_track(str(song)))
            self.assertIsNone(library.resolve_track("../track.mp3"))


if __name__ == "__main__":
    unittest.main()
