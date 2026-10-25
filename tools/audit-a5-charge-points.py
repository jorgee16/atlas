#!/usr/bin/env python3
"""Inspect original OSM IDs and geometry, without generating trusted tariff bindings.
The Geofabrik PBF is used because public Overpass endpoints timed out in CI.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT=Path('toll-section-audit')
URL='https://download.geofabrik.de/europe/portugal-latest.osm.pbf'
MAX_BYTES=1500*1024*1024

def download(url,destination,limit):
    req=urllib.request.Request(url,headers={'User-Agent':'Atlas-Toll-Geometry-Audit/1.0'})
    with urllib.request.urlopen(req,timeout=120) as response, destination.open('wb') as target:
        size=0
        while chunk:=response.read(1024*1024):
            size+=len(chunk)
            if size>limit: raise ValueError('OSM source exceeds size limit')
            target.write(chunk)
    return destination

if __name__=='__main__':
    import osmium
    ROOT.mkdir(exist_ok=True)
    cache=Path('.toll-source-cache');cache.mkdir(exist_ok=True)
    checksum=download(URL+'.md5',cache/'source.md5',4096).read_text().split()[0]
    if not re.fullmatch('[a-f0-9]{32}',checksum): raise ValueError('Invalid source checksum')
    pbf=download(URL,cache/'portugal.osm.pbf',MAX_BYTES)
    with pbf.open('rb') as f:
        if hashlib.file_digest(f,'md5').hexdigest()!=checksum: raise ValueError('OSM source checksum mismatch')
    class ChargePoints(osmium.SimpleHandler):
        def __init__(self):
            super().__init__();self.points={};self.ways=[]
        def node(self,n):
            if n.tags.get('barrier')!='toll_booth' and n.tags.get('highway')!='toll_gantry': return
            if not n.location.valid(): return
            lat,lon=n.location.lat,n.location.lon
            if 38.68<=lat<=38.78 and -9.48<=lon<=-9.18:
                self.points[n.id]={'type':'node','id':n.id,'lat':lat,'lon':lon,'tags':{t.k:t.v for t in n.tags}}
        def way(self,w):
            ids=[n.ref for n in w.nodes]
            refs=[r.replace(' ','') for r in re.split('[;,/]',w.tags.get('ref',''))]
            if 'A5' in refs or any(i in self.points for i in ids):
                self.ways.append({'type':'way','id':w.id,'nodes':ids,'tags':{t.k:t.v for t in w.tags}})
    handler=ChargePoints();handler.apply_file(str(pbf),locations=False)
    if not handler.points: raise ValueError('No physical charging points found; no mapping may be enabled')
    with pbf.open('rb') as f: sha=hashlib.file_digest(f,'sha256').hexdigest()
    result={'source':URL,'sourceSha256':sha,'sourceMd5':checksum,'retrievedAt':datetime.now(timezone.utc).isoformat(),
        'attribution':'OpenStreetMap contributors, ODbL; Geofabrik extract',
        'status':'unreviewed-candidates','elements':list(handler.points.values())+handler.ways}
    (ROOT/'a5-osm-charge-points.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print('A5_OSM_CHARGE_POINTS='+json.dumps(result,ensure_ascii=False))
