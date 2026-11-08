#!/usr/bin/env python3
"""Validate exported real-graph JNI quotes and the rendered route-preview evidence."""
import json
import csv
from pathlib import Path
import sys

root = Path(sys.argv[1])
cases = json.loads((root / 'a5-native-quotes.json').read_text())
if len(cases) < 132:
    raise ValueError('Missing carriageway/class/after-plaza/full-IKEA cases')
fixture_root=Path(__file__).resolve().parents[1]/'android/native-app/src/androidTest/assets/tolls'
new_expected={r['id']:r for name in ('a1-ticket-cases.csv','issue-2-approach-cases.csv','a5-access-cases.csv')
              for r in csv.DictReader((fixture_root/name).open(),delimiter=';')}
new_cases=set()
classes = set()
ikea_cases = set()
a28_expected = {r['id']: r for r in csv.DictReader((Path(__file__).resolve().parents[1] /
    'android/native-app/src/androidTest/assets/tolls/a28-mainline-cases.csv').open(), delimiter=';')}
a28_cases = set()
a16_expected = {r['id']: r for r in csv.DictReader((Path(__file__).resolve().parents[1] /
    'android/native-app/src/androidTest/assets/tolls/a16-mainline-cases.csv').open(), delimiter=';')}
a16_cases = set()
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
    elif case['id'].startswith('ikea-loures-2645-575-'):
        klass=after['tollVehicleClass']
        expected=1.60 if klass==1 else 3.10
        if after['tollPricing']!='exact' or abs(after['tollAmount']-expected)>1e-9 or after['distanceMeters']<30000:
            raise ValueError('Incorrect full IKEA itinerary quote: '+case['id'])
        charges=after['tollRoads']
        if len(charges)!=1 or charges[0].get('chargeId')!='brisa:0501':
            raise ValueError('Full IKEA route must retain its one physical crossing')
        ikea_cases.add(case['id'])
    elif case['id'].startswith('a28-'):
        expected = a28_expected[case['id']]
        if (after['tollPricing'] != 'exact' or abs(after['tollAmount'] - float(expected['expectedAmount'])) > 1e-9
                or after['tollVehicleClass'] != int(expected['class'])):
            raise ValueError('Incorrect A28 physical crossing quote: '+case['id'])
        if case['id'].startswith('a28-both-'):
            if after['distanceMeters'] < 20000 or {r['chargeId'] for r in after['tollRoads']} != {'vialivre:a28:angeiras','vialivre:a28:povoa'}:
                raise ValueError('Both A28 collection facilities and the real intervening route are required')
        a28_cases.add(case['id'])
    elif case['id'].startswith('a16-'):
        expected = a16_expected[case['id']]
        if (after['tollPricing'] != expected['expectedPricing'] or abs(after['tollAmount'] - float(expected['expectedAmount'])) > 1e-9
                or after['tollVehicleClass'] != int(expected['class'])):
            raise ValueError('Incorrect A16 physical crossing quote: '+case['id'])
        if case['id'].startswith('a16-unflagged-'):
            if before['hasTolls'] or before['tolledMeters'] != 0 or not after['hasTolls'] or after['tollPricing'] != 'exact':
                raise ValueError('A verified Ranholas crossing was hidden by a stale graph flag')
        a16_cases.add(case['id'])
    elif case['id'] in new_expected:
        expected=new_expected[case['id']]
        if expected['expectedPricing']=='exact':
            if after['tollPricing']!='exact' or abs(after['tollAmount']-float(expected['expectedAmount']))>1e-9:
                raise ValueError('Incorrect reviewed approach/ticket quote: '+case['id'])
            if case['id'].startswith('a1-') and [v['chargeId'] for v in after['tollRoads']]!=['brisa-published:0117:0122']:
                raise ValueError('The A1 ticket must follow the mapped 0117->0122 itinerary')
        elif expected['expectedPricing']=='none':
            if after['tollPricing']!='none' or after['tollAmount']!=0 or not after['tollFreeVerified']:
                raise ValueError('A reviewed start after the access gate was charged: '+case['id'])
        elif after['tollPricing']!='unavailable' or after['tollAmount'] is not None:
            raise ValueError('Starting inside a paid network cannot invent an entry or zero')
        if after['tollVehicleClass']!=int(expected['class']):
            raise ValueError('Wrong class in a reviewed quote: '+case['id'])
        if case['id'].startswith(('a5-oeiras-i-','a5-carcavelos-i-')) and after['tollAmount']>0:
            charge='brisa:0504' if case['id'].startswith('a5-oeiras-i-') else 'brisa:0502'
            if [v['chargeId'] for v in after['tollRoads']]!=[charge]:
                raise ValueError('Wrong physical access plaza: '+case['id'])
        new_cases.add(case['id'])
    elif after['tollPricing'] == 'exact':
        raise ValueError('Unreviewed city approaches were certified')
if new_cases!=set(new_expected):
    raise ValueError('Missing A1/approach proof cases')
if classes != {1, 2, 3, 4}:
    raise ValueError('Missing vehicle classes')
expected_ikea={f'ikea-loures-2645-575-{origin}-class-{klass}' for origin in ('south','north') for klass in (1,2,3,4)}
if ikea_cases!=expected_ikea:
    raise ValueError('Missing full IKEA origins/classes')
if a28_cases != set(a28_expected):
    raise ValueError('Missing A28 class/direction/after-gantry cases')
if a16_cases != set(a16_expected):
    raise ValueError('Missing A16 class/direction/after-plaza/unflagged crossing cases')
unavailable = json.loads((root / 'unavailable-crossing-quotes.json').read_text())
if len(unavailable) != 2 or {r['id'] for r in unavailable} != {'ranholas-missing-tariff','ranholas-unsupported-class'}:
    raise ValueError('Missing real JNI unavailable-price regressions')
for case in unavailable:
    before, after = case['before'], case['after']
    if not after['hasTolls'] or after['tollPricing'] != 'unavailable' or after['tollAmount'] is not None:
        raise ValueError('A missing tariff/class was represented as a free journey')
    for field in ['points','edgeIndexes','maneuvers','distanceMeters','durationSeconds','visualProtectedPoints']:
        if before.get(field) != after.get(field):
            raise ValueError('Unavailable pricing changed navigation: '+field)
route = json.loads((root / 'a5-preview-route.json').read_text())
if route['tollPricing'] != 'exact' or abs(route['tollAmount'] - 1.60) > 1e-9 or route['distanceMeters']<30000:
    raise ValueError('Route preview differs from the validated class-1 quote')
png = root / 'a5-exact-route-preview.png'
if not png.is_file() or png.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
    raise ValueError('Missing Android MapLibre screenshot')
ikea_png=root/'ikea-loures-exact-route-preview.png'
if not ikea_png.is_file() or ikea_png.read_bytes()[:8]!=b'\x89PNG\r\n\x1a\n':
    raise ValueError('Missing full IKEA route Android screenshot')
if 'confirmed' not in (root / 'a5-preview-text.txt').read_text():
    raise ValueError('Confirmed pricing is absent from the Android UI')
print(f'Validated {len(cases)+len(unavailable)} actual Portugal JNI price cases and Android preview evidence')
