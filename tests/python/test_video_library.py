from __future__ import annotations

from pathlib import Path
import tempfile
import threading
import unittest

from backend.video.library import VideoLibrary, stable_video_id
from backend.video.settings import VideoSettings


INSTALLATION_ID = "0123456789abcdef0123456789abcdef"


class VideoLibraryTests(unittest.TestCase):
    def make_settings(self, root: Path, *, recursive: bool = True) -> VideoSettings:
        return VideoSettings.from_folder(root, INSTALLATION_ID, recursive=recursive)

    def test_scan_accepts_only_browser_streamable_containers_and_hides_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nested = root / "Movies"
            nested.mkdir()
            (root / "Alpha.mp4").write_bytes(b"mp4")
            (nested / "Beta.webm").write_bytes(b"webm")
            for name in ("skip.mkv", "skip.avi", "skip.mov", "skip.m4v", "song.mp3"):
                (root / name).write_bytes(b"unsupported")
            library = VideoLibrary(
                metadata_reader=lambda path: {
                    "title": f"Video {path.stem}",
                    "duration": 42.25,
                }
            )

            status = library.scan_now(self.make_settings(root))
            payload = library.snapshot().public_dict()

            self.assertEqual(status.state, "complete")
            self.assertEqual(payload["count"], 2)
            self.assertEqual({item["format"] for item in payload["videos"]}, {"MP4", "WEBM"})
            for item in payload["videos"]:
                self.assertEqual(len(item["id"]), 32)
                self.assertNotIn("path", item)
                self.assertNotIn("filename", item)
                self.assertEqual(item["duration"], 42.25)
                self.assertEqual(item["stream_url"], f"/api/video/stream/{item['id']}")
            folders = {item["title"]: item["folder"] for item in payload["videos"]}
            self.assertEqual(folders["Video Alpha"], "(root)")
            self.assertEqual(folders["Video Beta"], "Movies")

    def test_nonrecursive_scan_excludes_nested_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nested = root / "nested"
            nested.mkdir()
            (root / "top.mp4").write_bytes(b"top")
            (nested / "nested.webm").write_bytes(b"nested")
            library = VideoLibrary()

            library.scan_now(self.make_settings(root, recursive=False))

            self.assertEqual([video.title for video in library.snapshot().videos], ["top"])

    def test_ids_are_stable_namespaced_and_lookup_never_accepts_paths(self) -> None:
        relative = Path("Movies") / "movie.mp4"
        self.assertEqual(
            stable_video_id("library-a", relative),
            stable_video_id("library-a", relative),
        )
        self.assertNotEqual(
            stable_video_id("library-a", relative),
            stable_video_id("library-b", relative),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "movie.mp4"
            path.write_bytes(b"movie")
            library = VideoLibrary()
            library.scan_now(self.make_settings(root))
            video = library.snapshot().videos[0]
            self.assertEqual(library.resolve_video(video.id), video)
            self.assertIsNone(library.resolve_video(str(path)))
            self.assertIsNone(library.resolve_video("../movie.mp4"))
            path.unlink()
            self.assertIsNone(library.resolve_video(video.id))

    def test_snapshot_is_published_only_after_scan_finishes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "first.mp4").write_bytes(b"first")
            gate = threading.Event()
            release = threading.Event()
            block = False

            def metadata(path: Path) -> dict[str, str]:
                if block and path.name == "first.mp4":
                    gate.set()
                    release.wait(3)
                return {}

            library = VideoLibrary(metadata_reader=metadata)
            settings = self.make_settings(root)
            library.scan_now(settings)
            original = library.snapshot()
            (root / "second.webm").write_bytes(b"second")
            block = True
            library.start_scan(settings)
            self.assertTrue(gate.wait(2))
            self.assertIs(library.snapshot(), original)
            release.set()
            for _ in range(200):
                if not library.status().running:
                    break
                threading.Event().wait(0.01)
            self.assertEqual(len(library.snapshot().videos), 2)


if __name__ == "__main__":
    unittest.main()
