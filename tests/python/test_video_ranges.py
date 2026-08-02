from __future__ import annotations

import unittest

from backend.video.ranges import ByteRange, parse_range_header


class VideoRangeTests(unittest.TestCase):
    def test_full_explicit_open_and_suffix_ranges(self) -> None:
        self.assertEqual(parse_range_header(None, 10), ByteRange(0, 9, 10, False))
        self.assertEqual(parse_range_header("bytes=2-5", 10), ByteRange(2, 5, 10, True))
        self.assertEqual(parse_range_header("bytes=7-", 10), ByteRange(7, 9, 10, True))
        self.assertEqual(parse_range_header("bytes=-3", 10), ByteRange(7, 9, 10, True))
        self.assertEqual(parse_range_header("bytes=-50", 10), ByteRange(0, 9, 10, True))

    def test_invalid_empty_unsatisfiable_and_multi_ranges_are_rejected(self) -> None:
        for value, size in (
            (None, 0),
            ("items=0-1", 10),
            ("bytes=", 10),
            ("bytes=9-2", 10),
            ("bytes=20-", 10),
            ("bytes=0-1,3-4", 10),
            ("bytes=-0", 10),
        ):
            with self.subTest(value=value, size=size), self.assertRaises(ValueError):
                parse_range_header(value, size)


if __name__ == "__main__":
    unittest.main()
