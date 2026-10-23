#!/usr/bin/env python3
"""Validate the completeness of actual Android map screenshots, not visual taste."""
import json
from pathlib import Path
import sys

root=Path(sys.argv[1])
summary=json.loads((root/'route-visual-summary.json').read_text())
cases=summary['cases']
assert len(summary['navigationImages'])==4, 'Missing navigation light/dark and online/offline images'
for name in summary['navigationImages']:
    assert (root/(name+'.png')).stat().st_size>1000
assert len(cases)>=48, 'Missing zoom/theme/source comparison screenshots'
assert {c['variant'] for c in cases}=={'raw','before','after'}
assert {c['zoom'] for c in cases}=={15,16,17,18}
assert {c['dark'] for c in cases}=={False,True}
assert {c['source'] for c in cases}=={'offline','online'}
groups={}
for case in cases:
    path=root/(case['image']+'.png')
    assert path.is_file() and path.stat().st_size>1000, f'Missing actual MapLibre snapshot: {path}'
    assert path.read_bytes()[:8]==b'\x89PNG\r\n\x1a\n', f'Invalid image: {path}'
    key=case['image'].rsplit('-',1)[0]
    groups.setdefault(key,set()).add(case['variant'])
assert all(v=={'raw','before','after'} for v in groups.values())
# Keep the evidence contract in sync with the Android review suite. The IC17
# motorway join is a fourth real route, not an optional synthetic screenshot.
required_routes={'lisbon-roundabout','sintra-curves','a5-access','cril-motorway-join'}
geometries={p.name.removesuffix('-geometry.json'):p for p in root.glob('*-geometry.json')}
missing=required_routes-geometries.keys()
assert not missing, f'Missing genuine C++ route outputs: {sorted(missing)}'
for road,path in geometries.items():
    evidence=json.loads(path.read_text())
    native=evidence['nativeRoute']
    assert native['edgeIndexes'], f'Route {road} is not backed by the C++ routing graph'
    raw=native['points']
    assert len(raw)>=3 and len(evidence['visual'])>=3, f'Empty route geometry: {road}'
    review_point=evidence['reviewPoint']
    assert 0 <= review_point < len(raw), f'Invalid review index: {road}'
    assert any(c['image'].startswith(road+'-') for c in cases), f'No MapLibre captures for {road}'
    if road=='cril-motorway-join':
        maneuvers=native['maneuvers']
        assert any('IC 17' in maneuver.get('road','') and maneuver.get('point')==review_point
                   for maneuver in maneuvers), 'Missing actual IC17 junction review anchor'
print('ATLAS_ROUTE_VISUAL_REVIEW '+json.dumps({'screenshots':len(cases),'comparisons':len(groups),
    'scope':summary['scope'],'note':'Human road-alignment review is required; screenshot existence is not visual approval.'}),flush=True)
