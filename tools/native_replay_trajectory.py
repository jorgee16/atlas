"""Distinguish a declared stationary fixture relocation from travel."""
import math


def is_setup_relocation(before, after):
    phase = after.get('phase')
    if phase not in ('drive-plan', 'walk-plan') or before.get('phase') != phase:
        return False
    if after.get('speed') != 0 or after.get('rawSpeed', after.get('speed')) != 0:
        return False
    age = after.get('fixAgeSeconds', math.inf)
    if not 0 <= age < 2:
        return False
    keys = ('renderLat', 'renderLon', 'gpsLat', 'gpsLon')
    if not all(isinstance(after.get(k), (int, float)) and math.isfinite(after[k]) for k in keys):
        return False
    gap = math.hypot((after['renderLat'] - after['gpsLat']) * 111320,
                     (after['renderLon'] - after['gpsLon']) * 111320 * math.cos(math.radians(after['renderLat'])))
    # plan() explicitly relocates mock GPS to the first graph point, then
    # asserts settled render/GPS agreement before the moving replay begins.
    return gap < 1.0
