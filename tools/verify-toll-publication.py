#!/usr/bin/env python3
"""Read-only verification of published country catalogs through the app's HTTPS origin."""
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

ORIGIN='https://pub-75539028275a4826aa383fdb89292ed7.r2.dev'
ASSETS=Path(__file__).resolve().parents[1]/'android/native-app/src/main/assets'

def get(path,limit):
    request=urllib.request.Request(ORIGIN+path,headers={'User-Agent':'Atlas-Toll-Catalog/1.0'})
    with urllib.request.urlopen(request,timeout=30) as response:
        if response.status!=200 or response.geturl()!=ORIGIN+path: raise ValueError('Unexpected public HTTP redirect/status')
        data=response.read(limit+1)
        if not 0<len(data)<=limit: raise ValueError('Invalid public response size')
        return data

if __name__=='__main__':
    receipts=[]
    for folder,namespace,scheme in [('tolls','toll-tariffs','road-average'),('toll-charges','toll-charges','fixed-crossing')]:
        for file in sorted((ASSETS/folder).glob('*.csv')):
            country=file.stem;encoded=urllib.parse.quote(country,safe='')
            manifest=json.loads(get(f'/{namespace}/{encoded}/manifest.json',65536))
            expected=file.read_bytes();digest=hashlib.sha256(expected).hexdigest()
            if manifest['schemaVersion']!=1 or manifest['country']!=country or manifest.get('scheme','road-average')!=scheme:
                raise ValueError('Wrong public catalog country/schema/scheme')
            if manifest['sha256']!=digest or manifest['sizeBytes']!=len(expected): raise ValueError('Public manifest integrity mismatch')
            metadata=dict(line[1:].split('=',1) for line in expected.decode().splitlines() if line.startswith('#') and '=' in line)
            metadata={k.strip():v.strip() for k,v in metadata.items()}
            if manifest['revision']!=int(metadata['version']): raise ValueError('Public revision mismatch')
            if manifest['path']!=f"/{namespace}/{encoded}/{manifest['revision']}/table.csv": raise ValueError('Unsafe public table path')
            data=get(manifest['path'],2*1024*1024)
            if data!=expected or hashlib.sha256(data).hexdigest()!=digest: raise ValueError('Public CSV integrity mismatch')
            receipt={'country':country,'namespace':namespace,'revision':manifest['revision'],'sha256':digest,'publicHttpsVerified':True}
            receipts.append(receipt);print(json.dumps(receipt))
    if not receipts: raise ValueError('No country catalogs found')
    Path('toll-public-verification.json').write_text(json.dumps(receipts,indent=2)+'\n')
