#!/usr/bin/env python3
"""Validate exported real-graph JNI quotes and the rendered route-preview evidence."""
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
cases = json.loads((root / 'a5-native-quotes.json').read_text())
if len(cases) < 21:
    raise ValueError('Missing carriageway/class/after-plaza cases')
classes = set()
for case in cases:
    before, after = case['before'], case['after']
    for field in ['points', 'edgeIndexes', 'maneuvers', 'distanceMeters',
                  'durationSeconds', 'visualProtectedPoints']:
        if before.get(field) != after.get(field):
            raise ValueError('Pricing changed authoritative navigation: ' + field)
    if case['id'].startswith('plaza-'):
        classes.add(after['tollVehicleClass'])
        expected = 1.60 if after['tollVehicleClass'] == 1 else 3.10
        if after['tollPricing'] != 'exact' or abs(after['tollAmount'] - expected) > 1e-9:
            raise ValueError('Incorrect real A5 quote: ' + case['id'])
    elif case['id'].startswith('after-plaza-'):
        if after['tollPricing'] != 'exact' or after['tollAmount'] != 0:
            raise ValueError('An already passed plaza was charged again')
    elif after['tollPricing'] == 'exact':
        raise ValueError('Unreviewed city approaches were certified')
if classes != {1, 2, 3, 4}:
    raise ValueError('Missing vehicle classes')
route = json.loads((root / 'a5-preview-route.json').read_text())
if route['tollPricing'] != 'exact' or abs(route['tollAmount'] - 1.60) > 1e-9:
    raise ValueError('Route preview differs from the validated class-1 quote')
png = root / 'a5-exact-route-preview.png'
if not png.is_file() or png.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
    raise ValueError('Missing Android MapLibre screenshot')
if 'exact' not in (root / 'a5-preview-text.txt').read_text():
    raise ValueError('Exact pricing is absent from the Android UI')
print(f'Validated {len(cases)} actual Portugal JNI quotes and Android preview evidence')
