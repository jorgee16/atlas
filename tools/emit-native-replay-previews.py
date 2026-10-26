#!/usr/bin/env python3
"""Expose small visual checkpoints through the read-only Actions log connector.
Original PNGs and full videos remain in the artifacts. This is for inspection
when the review environment cannot download binary artifacts over its terminal.
"""
import base64
from pathlib import Path
import shutil
import subprocess
import textwrap
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else 'ui-preview/gps-replay')
movies_root=Path(sys.argv[2] if len(sys.argv)>2 else 'ui-preview/atlas-gps-replay')
for checkpoint in sorted(root.glob('*.json')):
    print('ATLAS_CHECKPOINT '+checkpoint.name+' '+checkpoint.read_text().replace('\n',' '),flush=True)
if not shutil.which('ffmpeg'):
    print('Visual previews unavailable: ffmpeg not installed; see original artifact PNGs.')
    raise SystemExit(0)
preferred=['cursor-bitmap','drive-0','pan-before','pan-after','manual-zoom','drive-recenter','north-up-recenter','recreated-recenter','checking-recenter',
           'reroute-recenter','walking-compass-recenter','walking-stop','walk-15','walk-arrived']
preferred += sorted(p.stem for pattern in ['camera-*.png','drive-*.png','deviation-*.png','lisbon-*.png','sintra-*.png','a5-*.png','cril-*.png','09-*.png','10-*.png'] for p in root.glob(pattern) if p.stem not in preferred)
def emit(name,target):
    print('ATLAS_PREVIEW_BEGIN '+name,flush=True)
    for line in textwrap.wrap(base64.b64encode(target.read_bytes()).decode(),16000):
        print(line,flush=True)
    print('ATLAS_PREVIEW_END '+name,flush=True)

for name in preferred:
    source=root/(name+'.png')
    if not source.is_file():
        continue
    # Original full-resolution PNGs stay in artifacts. Keep the main job's text
    # log bounded so the review connector can actually open its evidence.
    if name.startswith(('lisbon-','sintra-','a5-','cril-')) and name not in {
        'sintra-curves-light-offline-z18-before','sintra-curves-light-offline-z18-after',
        'lisbon-roundabout-light-offline-z18-after-progress-boundary',
        'lisbon-roundabout-dark-offline-z18-after-progress-boundary',
        'a5-access-light-offline-z18-after','cril-motorway-join-light-offline-z18-after','a5-exact-route-preview'} and root.name!='atlas-selected':
        continue
    target=root/(name+'-preview.jpg')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(source),
        '-vf','scale=1080:-1' if name.startswith(('lisbon-','sintra-','a5-','cril-','09-','10-')) else 'scale=480:-1','-q:v','2' if name.startswith(('lisbon-','sintra-','a5-','cril-','09-','10-')) else '7',str(target)],check=True)
    emit(name,target)
# Sample the actual driving recording, including approach/circulation/exit.
movies=sorted(movies_root.glob('segment-*.mp4'))
for number,movie in enumerate(movies,1):
    result=subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(movie),
        '-vf','fps=1/30,scale=480:-1','-frames:v','6','-q:v','7',str(root/f'video-{number}-%02d.jpg')])
    if result.returncode:
        print('ATLAS_VIDEO_DECODE_FAILURE '+str(movie),flush=True)
for target in sorted(root.glob('video-*.jpg')):
    emit(target.stem,target)

