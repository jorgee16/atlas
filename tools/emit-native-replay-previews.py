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

root=Path('ui-preview/gps-replay')
if not shutil.which('ffmpeg'):
    print('Visual previews unavailable: ffmpeg not installed; see original artifact PNGs.')
    raise SystemExit(0)
preferred=['drive-0','manual-zoom','drive-recenter','north-up-recenter','recreated-recenter','checking-recenter',
           'reroute-recenter','walking-compass-recenter','walking-stop','walk-15','walk-arrived']
def emit(name,target):
    print('ATLAS_PREVIEW_BEGIN '+name,flush=True)
    for line in textwrap.wrap(base64.b64encode(target.read_bytes()).decode(),16000):
        print(line,flush=True)
    print('ATLAS_PREVIEW_END '+name,flush=True)

for name in preferred:
    source=root/(name+'.png')
    if not source.is_file():
        continue
    target=root/(name+'-preview.jpg')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(source),
        '-vf','scale=480:-1','-q:v','7',str(target)],check=True)
    emit(name,target)
# Sample the actual driving recording, including approach/circulation/exit.
movies=sorted(Path('ui-preview/atlas-gps-replay').glob('segment-*.mp4'))
if movies:
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(movies[0]),
        '-vf','fps=1/30,scale=480:-1','-frames:v','6','-q:v','7',str(root/'video-%02d.jpg')],check=True)
    for target in sorted(root.glob('video-*.jpg')):
        emit(target.stem,target)
