import codecs
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.music.library import MusicLibrary
from backend.music.lyrics import (
    MAX_LYRIC_BYTES,
    LyricDescriptor,
    lyrics_for_track,
    read_lyric_text,
)
from backend.music.settings import MusicSettings


class MusicLyricsTests(unittest.TestCase):
    def test_matching_english_lrc_is_preferred(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.flac"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text(
                "[00:01.00]Original\n[00:02.00]Words", encoding="utf-8"
            )
            track.with_suffix(".en.lrc").write_text(
                "[00:01.00]English\n[00:02.00]Lyrics", encoding="utf-8"
            )

            self.assertEqual(
                lyrics_for_track(track, root),
                ("[00:01.00]English\n[00:02.00]Lyrics", "lrc"),
            )

    def test_mismatched_translation_falls_back_to_untimed_english(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text("[00:01.00]Original", encoding="utf-8")
            track.with_suffix(".en.lrc").write_text("[00:08.00]Translation", encoding="utf-8")

            self.assertEqual(lyrics_for_track(track, root), ("Translation", "text"))

    def test_missing_timed_blank_rejects_a_synced_translation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text(
                "[00:01.00]Original\n[00:04.00]\n[00:08.00]Words",
                encoding="utf-8",
            )
            track.with_suffix(".en.lrc").write_text(
                "[00:01.00]English\n[00:08.00]Lyrics",
                encoding="utf-8",
            )

            self.assertEqual(lyrics_for_track(track, root), ("English\nLyrics", "text"))

    def test_english_text_precedes_raw_timed_lyrics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text("[00:01.00]Original", encoding="utf-8")
            track.with_suffix(".en.txt").write_text("Readable translation", encoding="utf-8")

            self.assertEqual(lyrics_for_track(track, root), ("Readable translation", "text"))

    def test_unpaired_english_lrc_then_raw_lrc_then_plain_text_fallbacks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            english = track.with_suffix(".en.lrc")
            raw = track.with_suffix(".lrc")
            plain = track.with_suffix(".txt")

            english.write_text("[00:01.00]English only", encoding="utf-8")
            self.assertEqual(lyrics_for_track(track, root), ("[00:01.00]English only", "lrc"))

            english.unlink()
            raw.write_text("[00:02.00]Original only", encoding="utf-8")
            self.assertEqual(lyrics_for_track(track, root), ("[00:02.00]Original only", "lrc"))

            raw.unlink()
            plain.write_text("Plain fallback", encoding="utf-8")
            self.assertEqual(lyrics_for_track(track, root), ("Plain fallback", "text"))

    def test_optional_sidecar_read_race_does_not_fail_the_track(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text("[00:01.00]Original", encoding="utf-8")

            with patch("backend.music.lyrics.os.open", side_effect=FileNotFoundError("sidecar disappeared")):
                self.assertEqual(lyrics_for_track(track, root), ("", ""))

                settings = MusicSettings.from_folder(root, "1" * 32)
                library = MusicLibrary(
                    metadata_reader=lambda _path: {"title": "Still playable"},
                    artwork_reader=lambda _path: None,
                )
                library.scan_now(settings)

            self.assertEqual(len(library.snapshot().tracks), 1)
            self.assertFalse(library.snapshot().tracks[0].has_lyrics)

    def test_each_sidecar_is_read_through_one_bounded_open_handle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text("[00:01.00]Original", encoding="utf-8")
            real_open = os.open
            opened_raw = 0

            def counting_open(path: str | bytes | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
                nonlocal opened_raw
                if Path(path).name == "song.lrc":
                    opened_raw += 1
                return real_open(path, flags, mode)

            with patch("backend.music.lyrics.os.open", side_effect=counting_open):
                self.assertEqual(lyrics_for_track(track, root), ("[00:01.00]Original", "lrc"))

            self.assertEqual(opened_raw, 1)

    def test_read_cap_rejects_oversize_and_max_plus_one_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            sidecar = track.with_suffix(".lrc")
            with sidecar.open("wb") as stream:
                stream.seek(MAX_LYRIC_BYTES)
                stream.write(b"x")

            self.assertEqual(sidecar.stat().st_size, MAX_LYRIC_BYTES + 1)
            self.assertEqual(lyrics_for_track(track, root), ("", ""))

            sidecar.write_bytes(b"[00:01]small")
            real_read = os.read
            injected = False

            def growing_read(descriptor: int, count: int) -> bytes:
                nonlocal injected
                if not injected:
                    injected = True
                    self.assertEqual(count, MAX_LYRIC_BYTES + 1)
                    return b"x" * (MAX_LYRIC_BYTES + 1)
                return real_read(descriptor, count)

            with patch("backend.music.lyrics.os.read", side_effect=growing_read):
                self.assertEqual(lyrics_for_track(track, root), ("", ""))

    def test_open_handle_identity_mismatch_rejects_a_name_swap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            track.with_suffix(".lrc").write_text("[00:01.00]Original", encoding="utf-8")

            with patch("backend.music.lyrics._same_open_file", return_value=False):
                self.assertEqual(lyrics_for_track(track, root), ("", ""))

    def test_bom_unicode_bomless_utf16_and_legacy_encodings(self) -> None:
        expected_utf8 = "[00:01]caf\u00e9"
        expected_japanese = "[00:01]\u65e5\u672c\u8a9e\u306e\u6b4c\u8a5e"
        expected_korean = "[00:01]\ud55c\uae00 \uac00\uc0ac"
        samples = {
            "utf-8 BOM": (expected_utf8.encode("utf-8-sig"), expected_utf8),
            "UTF-16 LE BOM": (codecs.BOM_UTF16_LE + expected_utf8.encode("utf-16-le"), expected_utf8),
            "UTF-16 BE BOM": (codecs.BOM_UTF16_BE + expected_utf8.encode("utf-16-be"), expected_utf8),
            "BOMless UTF-16 LE": (expected_utf8.encode("utf-16-le"), expected_utf8),
            "BOMless UTF-16 BE": (expected_utf8.encode("utf-16-be"), expected_utf8),
            "strict CP932": (expected_japanese.encode("cp932"), expected_japanese),
            "strict CP949": (expected_korean.encode("cp949"), expected_korean),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sidecar = root / "song.lrc"
            for label, (payload, expected) in samples.items():
                with self.subTest(encoding=label):
                    sidecar.write_bytes(payload)
                    self.assertEqual(read_lyric_text(sidecar, root), expected)

    def test_library_catalog_advertises_opaque_lyric_url(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track_path = root / "song.mp3"
            track_path.write_bytes(b"audio")
            track_path.with_suffix(".lrc").write_text("[00:03.00]Hello", encoding="utf-8")
            settings = MusicSettings.from_folder(root, "1" * 32)
            library = MusicLibrary(
                metadata_reader=lambda _path: {"title": "Song"},
                artwork_reader=lambda _path: None,
            )

            library.scan_now(settings)
            track = library.snapshot().tracks[0]
            public = track.public_dict()

            self.assertTrue(public["has_lyrics"])
            self.assertEqual(public["lyrics_format"], "lrc")
            self.assertEqual(public["lyrics_url"], f"/api/music/lyrics/{track.id}")
            self.assertNotIn(str(root), str(public))
            self.assertIsInstance(library.snapshot().lyrics_by_id[track.id], LyricDescriptor)
            self.assertNotIsInstance(library.snapshot().lyrics_by_id[track.id], str)
            self.assertEqual(library.lyrics_for(track.id), ("[00:03.00]Hello", "lrc"))
            self.assertIsNone(library.lyrics_for("missing"))

    def test_large_catalog_retains_only_constant_size_lyric_descriptors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body_marker = "unique-body-marker-"
            for index in range(48):
                track = root / f"song-{index:03d}.mp3"
                track.write_bytes(b"audio")
                track.with_suffix(".lrc").write_text(
                    f"[00:01.00]{body_marker}{index}-" + ("x" * 4096),
                    encoding="utf-8",
                )
            settings = MusicSettings.from_folder(root, "2" * 32)
            library = MusicLibrary(
                metadata_reader=lambda path: {"title": path.stem},
                artwork_reader=lambda _path: None,
            )

            library.scan_now(settings)
            snapshot = library.snapshot()

            self.assertEqual(len(snapshot.tracks), 48)
            self.assertEqual(len(snapshot.lyrics_by_id), 48)
            self.assertTrue(all(isinstance(value, LyricDescriptor) for value in snapshot.lyrics_by_id.values()))
            self.assertTrue(all(value.byte_size <= MAX_LYRIC_BYTES for value in snapshot.lyrics_by_id.values()))
            self.assertNotIn(body_marker, repr(snapshot.lyrics_by_id))
            self.assertNotIn(str(root), repr(snapshot.lyrics_by_id))

            selected = snapshot.tracks[0]
            selected.path.with_suffix(".lrc").write_text("[00:02.00]Read on demand", encoding="utf-8")
            self.assertEqual(library.lyrics_for(selected.id), ("[00:02.00]Read on demand", "lrc"))

    def test_sidecar_symlink_outside_library_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            track = root / "song.mp3"
            track.write_bytes(b"audio")
            external = Path(outside) / "secret.lrc"
            external.write_text("[00:01.00]Secret", encoding="utf-8")
            sidecar = track.with_suffix(".lrc")
            try:
                sidecar.symlink_to(external)
            except OSError:
                self.skipTest("symlinks are unavailable in this environment")

            self.assertEqual(lyrics_for_track(track, root), ("", ""))


if __name__ == "__main__":
    unittest.main()
