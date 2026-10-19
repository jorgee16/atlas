#!/usr/bin/env python3
"""Fail on missing dynamic evidence or excessive consecutive rendered steps."""
import json
import math
from pathlib import Path
root=Path('ui-preview/gps-replay')
frames=[json.loads(s) for s in (root/'frames.ndjson').read_text().splitlines() if s.strip()]
fixes=[json.loads(s) for s in (root/'fixes.ndjson').read_text().splitlines() if s.strip()]
assert len(frames)>300, 'No sustained MapLibre rendering evidence'
assert len(fixes)>80, 'No complete dynamic GPS replay'
assert list(Path('ui-preview/atlas-gps-replay').glob('*.mp4')), 'Missing emulator screen recording'

def distance(a,b):
    return math.hypot((a['renderLat']-b['renderLat'])*111320,
        (a['renderLon']-b['renderLon'])*111320*math.cos(math.radians(a['renderLat'])))
steps=[]
angles=[]
intervals=[]
good_steps=[]
for a,b in zip(frames,frames[1:]):
    dt=b['time']-a['time']
    if 0<dt<.15 and a.get('renderLat') is not None and b.get('renderLat') is not None:
        step=distance(a,b)
        steps.append(step)
        if a.get('phase','').startswith('drive-accuracy-') and a.get('accuracy',100)<=20 and a.get('speed',0)>=2:
            good_steps.append(step)
        angles.append(abs((b.get('mapBearing',0)-a.get('mapBearing',0)+180)%360-180))
        intervals.append(dt)
assert steps and max(steps)<6.0, f'Excessive cursor step: {max(steps,default=0):.2f} m'
assert max(angles)<60, f'Instantaneous camera reversal: {max(angles):.2f} degrees'
guided=[f for f in frames if f.get('follow') and f.get('headingUp')]
assert guided and all(abs(f.get('cursorBearing',0))<1.5 for f in guided), 'Heading-up cursor must point forward'
assert len(good_steps)>60, 'Missing rendered movement under good GPS'
moving_fraction=sum(step>.01 for step in good_steps)/len(good_steps)
assert moving_fraction>.65, f'1 Hz fixes did not produce continuous visible movement: {moving_fraction:.2%}'
phases=sorted({f.get('phase','') for f in frames})
for gap in [2,5,9]:
    assert any(f'gap-{gap}' in p for p in phases), f'No {gap}s GPS gap evidence'
assert any('walk' in p for p in phases), 'No walking evidence'
assert {5,20,35,60,100}.issubset({f['accuracy'] for f in fixes}), 'Missing accuracy cases'
summary={'frames':len(frames),'fixes':len(fixes),'phases':phases,
    'movingFrameFractionUnderGoodGps':moving_fraction,
    'maxConsecutiveCursorStepMeters':max(steps),'maxConsecutiveCameraRotationDegrees':max(angles),
    'medianRenderIntervalSeconds':sorted(intervals)[len(intervals)//2],
    'scope':'Actual mainland Portugal C++ routing, mock Android GPS provider, NavigationService, JNI, MapLibre and UI; offline PMTiles installed; POI/address search package not installed.'}
(root/'summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
