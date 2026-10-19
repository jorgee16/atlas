#!/usr/bin/env python3
"""Fail on missing dynamic evidence or excessive consecutive rendered steps."""
import json
import math
import subprocess
from pathlib import Path
root=Path('ui-preview/gps-replay')
frames=[json.loads(s) for s in (root/'frames.ndjson').read_text().splitlines() if s.strip()]
fixes=[json.loads(s) for s in (root/'fixes.ndjson').read_text().splitlines() if s.strip()]
assert len(frames)>300, 'No sustained MapLibre rendering evidence'
assert len(fixes)>80, 'No complete dynamic GPS replay'
movies=list(Path('ui-preview/atlas-gps-replay').glob('*.mp4'))
assert movies, 'Missing emulator screen recording'
video_seconds=0.0
for movie in movies:
    probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration',
        '-of','default=noprint_wrappers=1:nokey=1',str(movie)],capture_output=True,text=True,check=True)
    duration=float(probe.stdout.strip())
    assert duration>0, f'Empty video: {movie}'
    video_seconds+=duration
assert video_seconds>=(fixes[-1]['time']-fixes[0]['time'])*.9, 'Video does not cover the GPS replay' 

def distance(a,b):
    return math.hypot((a['renderLat']-b['renderLat'])*111320,
        (a['renderLon']-b['renderLon'])*111320*math.cos(math.radians(a['renderLat'])))
steps=[]
angles=[]
intervals=[]
good_steps=[]
observations=[]
for a,b in zip(frames,frames[1:]):
    dt=b['time']-a['time']
    if 0<dt<.15 and a.get('renderLat') is not None and b.get('renderLat') is not None:
        step=distance(a,b)
        steps.append(step)
        observations.append((step,a,b))
        if a.get('phase','').startswith('drive-accuracy-') and a.get('accuracy',100)<=20 and a.get('speed',0)>=2:
            good_steps.append(step)
        angles.append(abs((b.get('mapBearing',0)-a.get('mapBearing',0)+180)%360-180))
        intervals.append(dt)
for step,a,b in sorted(observations,key=lambda item:item[0],reverse=True)[:5]:
    print('ATLAS_LARGEST_RENDER_STEP '+json.dumps({'meters':step,'before':a,'after':b}),flush=True)
assert steps and max(steps)<6.0, f'Excessive cursor step: {max(steps,default=0):.2f} m'
assert max(angles)<60, f'Instantaneous camera reversal: {max(angles):.2f} degrees'
guided=[f for f in frames if f.get('follow') and f.get('headingUp')]
assert guided and all(abs(f.get('cursorBearing',0))<1.5 for f in guided), 'Heading-up cursor must point forward'
# Check actual camera course against replay truth. A shared erroneous route
# heading can make cursor/map agree while both point backwards. Allow four
# seconds after a genuine sharp turn, and exclude stale/poor-quality fixes.
truth_frames=[f for f in guided if f.get('speed',0)>=1.2 and f.get('accuracy',100)<=20
    and f.get('bearingAccuracy',100)<=15 and f.get('truthStableFor',0)>=4
    and 0<=f['time']-f.get('truthFixTime',0)<1.5
    and (f.get('phase','').startswith('drive-accuracy-') or f.get('phase') in ['reroute-replay','walking'])]
heading_errors=[(abs((f['mapBearing']-f['truthHeading']+180)%360-180),f) for f in truth_frames]
for error,frame in sorted(heading_errors,key=lambda item:item[0],reverse=True)[:3]:
    print('ATLAS_HEADING_TRUTH_ERROR '+json.dumps({'degrees':error,'frame':frame}),flush=True)
assert len(heading_errors)>300, 'Missing camera/ground-truth heading evidence'
assert max(error for error,_ in heading_errors)<100, 'Camera reversed against confirmed movement'
assert len(good_steps)>60, 'Missing rendered movement under good GPS'
moving_fraction=sum(step>.01 for step in good_steps)/len(good_steps)
assert moving_fraction>.65, f'1 Hz fixes did not produce continuous visible movement: {moving_fraction:.2%}'
phases=sorted({f.get('phase','') for f in frames})
for gap in [2,5,9]:
    assert any(f'gap-{gap}' in p for p in phases), f'No {gap}s GPS gap evidence'
assert any('walk' in p for p in phases), 'No walking evidence'
assert {5,20,35,60,100}.issubset({f['accuracy'] for f in fixes}), 'Missing accuracy cases'
summary={'videoDurationSeconds':video_seconds,'frames':len(frames),'fixes':len(fixes),'phases':phases,
    'movingFrameFractionUnderGoodGps':moving_fraction,
    'maxConsecutiveCursorStepMeters':max(steps),'maxConsecutiveCameraRotationDegrees':max(angles),
    'maxStableGoodGpsHeadingErrorDegrees':max(error for error,_ in heading_errors),
    'headingTruthFrames':len(heading_errors),
    'medianRenderIntervalSeconds':sorted(intervals)[len(intervals)//2],
    'scope':'Actual mainland Portugal C++ routing, mock Android GPS provider, NavigationService, JNI, MapLibre and UI; offline PMTiles installed; POI/address search package not installed.'}
(root/'summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
