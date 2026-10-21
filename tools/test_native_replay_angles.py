import math
import unittest

from native_replay_angles import heading_up_cursor_error


class ReplayCursorAngleTest(unittest.TestCase):
    def test_recorded_north_wrap_is_forward(self):
        # Exact cursor bearing recorded in run 39560399905. It is a
        # 0.118-degree offset, not a 359-degree reversal.
        self.assertAlmostEqual(heading_up_cursor_error(359.88167690086743), 0.11832309913257)

    def test_same_strict_one_point_five_degree_limit_on_both_sides(self):
        for bearing in [0.0, 1.49, -1.49, 358.51, 361.49]:
            self.assertLess(heading_up_cursor_error(bearing), 1.5)
        for bearing in [1.5, -1.5, 358.5, 1.51, 358.49, 180.0, 115.0]:
            self.assertGreaterEqual(heading_up_cursor_error(bearing), 1.5)

    def test_invalid_angle_cannot_pass(self):
        for bearing in [math.inf, -math.inf, math.nan]:
            self.assertEqual(heading_up_cursor_error(bearing), math.inf)


if __name__ == '__main__':
    unittest.main()
