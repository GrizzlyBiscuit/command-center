from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from backend.music import metadata


class MusicMetadataTests(unittest.TestCase):
    def test_mutagen_is_optional(self) -> None:
        with patch.object(metadata, "MutagenFile", None):
            self.assertEqual(metadata.read_metadata(Path("song.mp3")), {})

    def test_corrupt_file_does_not_abort_scan_metadata(self) -> None:
        with patch.object(metadata, "MutagenFile", side_effect=ValueError("corrupt")):
            self.assertEqual(metadata.read_metadata(Path("song.flac")), {})

    def test_mp4_video_container_is_not_in_music_extensions(self) -> None:
        self.assertNotIn(".mp4", metadata.AUDIO_EXTENSIONS)
        self.assertIn(".m4a", metadata.AUDIO_EXTENSIONS)


if __name__ == "__main__":
    unittest.main()
