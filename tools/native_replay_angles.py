"""Circular angle comparisons for navigation evidence (degrees)."""
import math


def heading_up_cursor_error(bearing):
    """Distance from screen-forward, treating 359.9 degrees as -0.1."""
    if not math.isfinite(bearing):
        return math.inf
    return abs((bearing + 180.0) % 360.0 - 180.0)
