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
assert len(list(root.glob('*-geometry.json')))==3, 'Missing genuine C++ route outputs'
print('ATLAS_ROUTE_VISUAL_REVIEW '+json.dumps({'screenshots':len(cases),'comparisons':len(groups),
    'scope':summary['scope'],'note':'Human road-alignment review is required; screenshot existence is not visual approval.'}),flush=True)
