#!/usr/bin/env python3
"""Install routing from the real Portugal manifest, never a fabricated test graph.
Routing and offline PMTiles are installed; POI/address downloads are not tested.
"""
import concurrent.futures
import hashlib
import io
import os
import subprocess
import urllib.error
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev'
catalog = json.loads((ROOT/'android/native-app/src/main/assets/regions.json').read_text())
region = next(r for r in catalog['regions'] if r['id'] == 'portugal')
entries = [e for e in region['package']['files'] if '/routing/mainland/' in e['url'] or e['url'] == region['assets'].get('map')]
assert len(entries) >= 8, 'Portugal mainland routing manifest is required'
cache = ROOT/'.native-gps-routing'
cache.mkdir(exist_ok=True)
report = ROOT/'ui-preview/gps-replay-input'
report.mkdir(parents=True,exist_ok=True)
(report/'routing-manifest.json').write_text(json.dumps({'origin':ORIGIN,'version':region['version'],
    'scope':'Portugal mainland routing and offline PMTiles; POI/address search package not installed','files':entries},indent=2))


def download(e):
    url = e['url']
    path = cache/url.rsplit('/',1)[1]
    def valid():
        return path.is_file() and path.stat().st_size == e['sizeBytes'] and hashlib.file_digest(path.open('rb'),'sha256').hexdigest() == e['sha256']
    if not valid():
        try:
            request=urllib.request.Request(ORIGIN+url, headers={'User-Agent':'Atlas-Native-GPS-Replay/1.0'})
            with urllib.request.urlopen(request, timeout=120) as source, path.open('wb') as target:
                while data := source.read(1024*1024):
                    target.write(data)
        except urllib.error.HTTPError as error:
            (report/(path.name+'.http-error.txt')).write_text(
                f'{ORIGIN+url}\nHTTP {error.code}\n'+error.read(4096).decode('utf-8','replace'))
            # Use the same configured identity/bucket as the repository's R2
            # publishing workflows. This performs object GETs only, never writes.
            account=os.environ.get('R2_ACCOUNT_ID','')
            key=os.environ.get('R2_ACCESS_KEY_ID','')
            secret=os.environ.get('R2_SECRET_ACCESS_KEY','')
            if not all((account,key,secret)):
                raise RuntimeError('Public R2 asset unavailable and existing R2 read credentials are not configured') from error
            environment=dict(os.environ,AWS_ACCESS_KEY_ID=key,AWS_SECRET_ACCESS_KEY=secret,
                AWS_DEFAULT_REGION='auto',AWS_EC2_METADATA_DISABLED='true')
            subprocess.run(['aws','--endpoint-url',f'https://{account}.r2.cloudflarestorage.com',
                's3','cp','s3://atlas-regions/'+url.lstrip('/'),str(path),'--only-show-errors'],
                env=environment,check=True)
            print(f'Read {url} using configured R2 identity (public HTTP {error.code})')
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
print(f'Verified {len(files)} real Portugal routing/map assets; archive={archive}')
