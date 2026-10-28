#!/usr/bin/env python3
"""Audit actual Portugal graph v6 toll-marked driving edges; never change data."""
import argparse
from collections import defaultdict
import concurrent.futures
import hashlib
import json
import mmap
import os
from pathlib import Path
import re
import struct
import subprocess
import urllib.error
import urllib.request

ORIGIN='https://pub-75539028275a4826aa383fdb89292ed7.r2.dev'
ROOT=Path(__file__).resolve().parents[1]

def u32(data, offset): return struct.unpack_from('<I', data, offset)[0]

def scan(paths, eligible, explicitly_free=None, reference_estimates=False):
    explicitly_free=set(explicitly_free or ())
    totals=defaultdict(lambda: {'directedEdges':0,'directedMeters':0.0,'estimatedMeters':0.0,'explicitlyFreeMeters':0.0,'referenceEstimatedMeters':0.0,'unpricedEdges':0})
    with paths['roads.bin'].open('rb') as rf, paths['strings.bin'].open('rb') as sf, paths['edges.bin'].open('rb') as ef:
        with mmap.mmap(rf.fileno(),0,access=mmap.ACCESS_READ) as roads, mmap.mmap(sf.fileno(),0,access=mmap.ACCESS_READ) as strings, mmap.mmap(ef.fileno(),0,access=mmap.ACCESS_READ) as edges:
            for data, magic in [(roads,b'RROD'),(strings,b'RSTR'),(edges,b'REDG')]:
                if data[:4]!=magic or u32(data,4)!=6: raise ValueError('Unsupported graph format')
            if u32(roads,12)!=36 or u32(edges,16)!=20: raise ValueError('Unsupported record sizes')
            count=u32(roads,8)
            if len(roads)!=16+count*36 or len(strings)!=12+u32(strings,8): raise ValueError('Invalid road/string length')
            refs=[]
            for index in range(count):
                at=16+index*36;offset=u32(roads,at+4)+12
                end=strings.find(b'\0',offset)
                if offset<12 or end<offset: raise ValueError('Invalid string reference')
                ref=strings[offset:end].decode('utf-8')
                tokens=[re.sub(r'\s+','',x).upper() for x in re.split('[;,/]',ref)]
                # Same first-known-reference policy as the common estimator.
                matched=next((x for x in tokens if x in eligible),None)
                refs.append((ref or '(no reference)',bool(u32(roads,at+32)&4),bool(matched and eligible[matched])))
            start=20+(u32(edges,8)+1)*4;edge_count=u32(edges,12)
            if len(edges)!=start+edge_count*20: raise ValueError('Invalid edge length')
            for index in range(edge_count):
                at=start+index*20
                if not u32(edges,at+12)&0x20000000: continue
                road=u32(edges,at+16)
                if road>=count: raise ValueError('Invalid road index')
                ref,tolled,priced=refs[road]
                if not tolled: continue
                meters=u32(edges,at+4)/10
                row=totals[ref];row['directedEdges']+=1;row['directedMeters']+=meters
                tokens=set(re.sub(r'\s+','',r).upper() for r in re.split('[;,/]',ref))
                if tokens&explicitly_free:
                    if not any(r in eligible and r not in explicitly_free for r in tokens):row['explicitlyFreeMeters']+=meters
                    else:row['unpricedEdges']+=1
                elif priced: row['estimatedMeters']+=meters
                elif reference_estimates:row['referenceEstimatedMeters']+=meters
                else:row['unpricedEdges']+=1
    return totals

def fetch(entry, cache):
    path=cache/(hashlib.sha256(entry['url'].encode()).hexdigest()[:12]+'-'+entry['url'].rsplit('/',1)[1])
    def valid():
        return path.is_file() and path.stat().st_size==entry['sizeBytes'] and hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==entry['sha256']
    if not valid():
        try:
            request=urllib.request.Request(ORIGIN+entry['url'],headers={'User-Agent':'Atlas-Toll-Coverage/1.0'})
            with urllib.request.urlopen(request,timeout=120) as source, path.open('wb') as target:
                while chunk:=source.read(1024*1024): target.write(chunk)
        except urllib.error.HTTPError:
            account=os.environ.get('R2_ACCOUNT_ID','')
            if not all(os.environ.get(k) for k in ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']): raise
            env=dict(os.environ,AWS_ACCESS_KEY_ID=os.environ['R2_ACCESS_KEY_ID'],AWS_SECRET_ACCESS_KEY=os.environ['R2_SECRET_ACCESS_KEY'],AWS_DEFAULT_REGION='auto',AWS_EC2_METADATA_DISABLED='true')
            subprocess.run(['aws','--endpoint-url',f'https://{account}.r2.cloudflarestorage.com','s3','cp','s3://atlas-regions/'+entry['url'].lstrip('/'),str(path),'--only-show-errors'],env=env,check=True)
    if not valid(): raise ValueError('Graph integrity mismatch: '+entry['url'])
    return entry,path

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=Path('toll-coverage.json'));parser.add_argument('--require-estimated-coverage',action='store_true');args=parser.parse_args()
    catalog=json.loads((ROOT/'android/native-app/src/main/assets/regions.json').read_text())
    country='Portugal';csv=(ROOT/'android/native-app/src/main/assets/tolls'/f'{country}.csv').read_text()
    metadata={};known=set()
    for line in csv.splitlines():
        if line.startswith('#') and '=' in line:
            k,v=line[1:].split('=',1);metadata[k.strip()]=v.strip()
        elif line and not line.startswith('#') and not line.startswith('road;'): known.add(line.split(';')[0])
    allowed=set(metadata.get('estimateRoads',','.join(known)).split(','));eligible={r:r in allowed for r in known}
    cache=ROOT/'.toll-coverage-cache';cache.mkdir(exist_ok=True)
    reports=[];all_files=[]
    for region in catalog['regions']:
        if region.get('country')!=country: continue
        entries=[e for e in region['package']['files'] if '/routing/' in e['url'] and e['url'].rsplit('/',1)[1] in ['roads.bin','strings.bin','edges.bin']]
        groups=defaultdict(dict)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            for entry,path in executor.map(lambda e:fetch(e,cache),entries):
                groups[entry['url'].rsplit('/',1)[0]][entry['url'].rsplit('/',1)[1]]=path;all_files.append(entry)
        for partition,paths in sorted(groups.items()):
            if len(paths)!=3: raise ValueError('Incomplete partition')
            roads=scan(paths,eligible,set(metadata.get('freeRoads','').split(',')),metadata.get('referenceEstimate')=='road-then-country-average')
            reports.append({'region':region['id'],'version':region['version'],'partition':partition,'roads':dict(sorted(roads.items()))})
    if not reports: raise ValueError('No real routing partitions found')
    total=sum(v['directedMeters'] for p in reports for v in p['roads'].values())
    priced=sum(v['estimatedMeters'] for p in reports for v in p['roads'].values())
    exempt=sum(v['explicitlyFreeMeters'] for p in reports for v in p['roads'].values())
    reference=sum(v['referenceEstimatedMeters'] for p in reports for v in p['roads'].values())
    unpriced=sum(v['unpricedEdges'] for p in reports for v in p['roads'].values())
    result={'vehicleClass':1,'referenceEstimatedMeters':reference,'estimatedCoveragePercent':100*(priced+exempt+reference)/total if total else None,'unpricedDirectedEdges':unpriced,'country':country,'tariffRevision':metadata['version'],'tariffSha256':hashlib.sha256(csv.encode()).hexdigest(),
        'scope':'All Portugal routing partitions in the bundled region manifest; directed toll-marked driving edges, not unique physical road km or exact-price coverage',
        'directedTolledMeters':total,'directedEstimatedMeters':priced,'estimatedPercent':100*priced/total if total else None,'directedExplicitlyFreeMeters':exempt,'knownPricePercent':100*(priced+exempt)/total if total else None,'partitions':reports,'verifiedGraphFiles':all_files}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['partitions','verifiedGraphFiles']},ensure_ascii=False))
    for p in reports: print(p['partition'],len(p['roads']),'toll road refs')
    if args.require_estimated_coverage and unpriced:raise SystemExit('National estimated coverage incomplete: '+str(unpriced)+' directed edges remain unpriced')
