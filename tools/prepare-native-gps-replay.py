#!/usr/bin/env python3
"""Install routing from the real Portugal manifest, never a fabricated test graph.
Only routing is installed: this is not evidence of full offline PMTiles/search.
"""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev'
catalog = json.loads((ROOT/'android/native-app/src/main/assets/regions.json').read_text())
region = next(r for r in catalog['regions'] if r['id'] == 'portugal')
entries = [e for e in region['package']['files'] if '/routing/mainland/' in e['url']]
assert len(entries) >= 8, 'Portugal mainland routing manifest is required'
cache = ROOT/'.native-gps-routing'
cache.mkdir(exist_ok=True)

def download(e):
    url = e['url']
    path = cache/url.rsplit('/',1)[1]
    def valid():
        return path.is_file() and path.stat().st_size == e['sizeBytes'] and hashlib.file_digest(path.open('rb'),'sha256').hexdigest() == e['sha256']
    if not valid():
        with urllib.request.urlopen(ORIGIN+url, timeout=120) as source, path.open('wb') as target:
            while data := source.read(1024*1024):
                target.write(data)
    assert valid(), f'Invalid real Portugal asset: {url}'
    return e, path

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    files = list(executor.map(download, entries))
archive = ROOT/'atlas-portugal-routing.tar'
with tarfile.open(archive,'w') as tar:
    for entry, path in files:
        tar.add(path, arcname=f"offline/portugal/{region['version']}/{entry['url'].lstrip('/')}")
    marker = str(region['version']).encode()
    info = tarfile.TarInfo('offline/portugal.installed')
    info.size=len(marker)
    tar.addfile(info, io.BytesIO(marker))
report = ROOT/'ui-preview/gps-replay-input'
report.mkdir(parents=True,exist_ok=True)
(report/'routing-manifest.json').write_text(json.dumps({'origin':ORIGIN,'version':region['version'],
    'scope':'Portugal mainland routing only; no PMTiles or search package installed','files':entries},indent=2))
print(f'Verified {len(files)} real Portugal routing assets; archive={archive}')
