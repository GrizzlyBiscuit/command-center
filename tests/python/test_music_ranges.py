from __future__ import annotations

import unittest

from backend.music.ranges import ByteRange, parse_range_header


class MusicRangeTests(unittest.TestCase):
    def test_full_and_partial_ranges(self) -> None:
        self.assertEqual(parse_range_header(None, 100), ByteRange(0, 99, 100, False))
        self.assertEqual(parse_range_header("bytes=10-19", 100), ByteRange(10, 19, 100, True))
        self.assertEqual(parse_range_header("bytes=90-", 100), ByteRange(90, 99, 100, True))
        self.assertEqual(parse_range_header("bytes=-10", 100), ByteRange(90, 99, 100, True))

    def test_invalid_or_multi_ranges_are_rejected(self) -> None:
        for value in ("bytes=", "bytes=100-", "bytes=20-10", "bytes=0-1,5-9", "items=0-1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_range_header(value, 100)
        with self.assertRaises(ValueError):
            parse_range_header(None, 0)


if __name__ == "__main__":
    unittest.main()
