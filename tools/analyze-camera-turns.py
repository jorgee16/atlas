#!/usr/bin/env python3
"""Measure, not 'fix', Atlas camera lag on a real Portugal route GPS replay.

Consumes Android MapLibre frame telemetry and the EXACT native-C++ route it
drove. Uses only frames with a fresh actual GPS fix; the old camera-smoke
frames often had >40 seconds of stale GNSS and must not count as bend evidence.
"""
import json
import math
import statistics
import sys
from pathlib import Path

folder=Path(sys.argv[1] if len(sys.argv)>1 else 'ui-preview/camera-smoke')
route=json.loads((folder/'curve-route.json').read_text())
points=route['points']
track=[0.0]
for a,b in zip(points,points[1:]):
    x=(b[0]-a[0])*math.cos(math.radians((a[1]+b[1])*.5))*111_320
    y=(b[1]-a[1])*111_320
    track.append(track[-1]+math.hypot(x,y))
native_meters=route['distanceMeters']
assert len(points)>10 and native_meters>960, 'No real Portugal bend route'
def angle(a,b):
    return abs((a-b+180)%360-180)
def position(m):
    m=max(0.0,min(native_meters,m))*track[-1]/native_meters
    lo,hi=0,len(track)-1
    while lo+1<hi:
        mid=(lo+hi)//2
        if track[mid]<m: lo=mid
        else: hi=mid
    gap=track[hi]-track[lo]
    t=(m-track[lo])/gap if gap>1e-6 else 0.0
    return (points[lo][0]+(points[hi][0]-points[lo][0])*t,
            points[lo][1]+(points[hi][1]-points[lo][1])*t)
def route_heading(m):
    a=position(m-2)
    b=position(m+7)
    east=(b[0]-a[0])*math.cos(math.radians((a[1]+b[1])/2))
    north=b[1]-a[1]
    if east*east+north*north<1e-18: return None
    return math.degrees(math.atan2(east,north))%360
frames=[json.loads(s) for s in (folder/'frames.ndjson').read_text().splitlines() if s]
all_curve=[x for x in frames if x.get('phase')=='curve-replay']
valid=[]
for x in all_curve:
    m=x.get('along')
    if not (isinstance(m,(int,float)) and math.isfinite(m) and
            x.get('routeRendering') and x.get('follow') and
            x.get('headingUp') and
            0 <= x.get('fixAgeSeconds',-1)<1.5 and
            x.get('speed',0)>=4 and x.get('accuracy',100)<=20 and
            isinstance(x.get('mapBearing'),(int,float)) and
            isinstance(x.get('travelBearing'),(int,float))):
        continue
    target=route_heading(m)
    if target is None: continue
    y=dict(x)
    y['routeTangent']=target
    y['cameraToRoute']=angle(x['mapBearing'],target)
    y['cameraToTravel']=angle(x['mapBearing'],x['travelBearing'])
    y['travelToRoute']=angle(x['travelBearing'],target)
    y['rawToRoute']=angle(x.get('rawBearing',x['travelBearing']),target)
    valid.append(y)
assert len(valid)>=100, f'Insufficient fresh GNSS camera frames: {len(valid)}'
assert len({round(x['fixTime'],2) for x in valid})>=20, 'Did not receive ongoing 1Hz fixes'
assert max(x['along'] for x in valid)>780, 'Did not reach non-roundabout bend'
regions=[('straight_before',0,320),('approach_bends',320,450),
         ('roundabout',450,560),('later_curve',745,875)]
def percent(values,p):
    return sorted(values)[round((len(values)-1)*p)]
def stats(rows,key):
    values=[r[key] for r in rows]
    return None if not values else {
        'medianDeg':round(statistics.median(values),2),
        'p90Deg':round(percent(values,.90),2),
        'p95Deg':round(percent(values,.95),2),
        'maxDeg':round(max(values),2)
    }
summary={'source':'instrumented Android GPS at 1Hz, JNI and MapLibre',
         'routeMeters':native_meters,'totalCurveFrames':len(all_curve),
         'eligibleFreshFrames':len(valid),
         'freshFixes':len({round(x['fixTime'],2) for x in valid}),
         'segments':{}}
for name,a,b in regions:
    subset=[x for x in valid if a<=x['along']<b]
    summary['segments'][name]={
        'frames':len(subset),'cameraVsRoute':stats(subset,'cameraToRoute'),
        'cameraVsTravelHeading':stats(subset,'cameraToTravel'),
        'travelHeadingVsRoute':stats(subset,'travelToRoute'),
        'rawGpsVsRoute':stats(subset,'rawToRoute')
    }
# Do not mistake GNSS direction latency for a slow camera rotation.
# Report both distinct errors in the same REAL frames.
largest=sorted(valid,key=lambda x:x['cameraToRoute'],reverse=True)[:12]
summary['worstFrames']=[{key:round(x[key],2) if isinstance(x.get(key),(int,float)) else x.get(key)
    for key in ('time','along','fixAgeSeconds','speed','mapBearing',
                'travelBearing','rawBearing','routeTangent','cameraToRoute',
                'cameraToTravel','travelToRoute','guidance','offRoute')}
    for x in largest]
(folder/'curve-camera-diagnostic.json').write_text(json.dumps(summary,indent=2)+'\n')
print('ATLAS_CURVE_CAMERA_DIAGNOSTIC',json.dumps(summary))
# Measurements only: no angular error threshold until we decide what is
# physically achievable at speed and how the route/GPS signals disagree.
