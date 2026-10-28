#!/usr/bin/env python3
"""Exercise real C++ routing in Portugal. These are graph probes, not GPS replay."""
import argparse
import importlib.util
import json
import re
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
FILES=['nodes.bin','edges.bin','geometry.bin','roads.bin','strings.bin','restrictions.bin','spatial-index.bin']
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',required=True);p.add_argument('--output',type=Path,default=Path('toll-audit/national-route-probes.json'));args=p.parse_args()
    catalog=json.loads((ROOT/'android/native-app/src/main/assets/regions.json').read_text())
    region=next(r for r in catalog['regions'] if r['id']=='portugal')
    spec=importlib.util.spec_from_file_location('audit',ROOT/'tools/audit-toll-graph.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
    cache=ROOT/'.toll-coverage-cache';cache.mkdir(exist_ok=True)
    entries=[e for e in region['package']['files'] if '/routing/mainland/' in e['url'] and e['url'].rsplit('/',1)[1] in FILES]
    if len(entries)!=7:raise ValueError('Complete real graph identity required')
    graph=cache/'graph';graph.mkdir(exist_ok=True)
    for entry in entries:
        _,path=audit.fetch(entry,cache);link=graph/entry['url'].rsplit('/',1)[1]
        if link.exists() or link.is_symlink():link.unlink()
        link.symlink_to(path.resolve())
    command=[args.binary,str(graph),'Portugal',str(ROOT/'android/native-app/src/main/assets/tolls/Portugal.csv')]
    process=subprocess.run(command,text=True,capture_output=True)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.with_suffix('.stderr.txt').write_text(process.stderr)
    if process.returncode:
        args.output.with_suffix('.partial.json').write_text(process.stdout)
        raise RuntimeError('Actual native route probe failed: '+process.stderr.strip())
    result=json.loads(process.stdout)
    records=result['probes'];classes={r['vehicleClass'] for r in records}
    if classes!={1,2,3,4} or len(records)!=4*(result['roadReferences']+4):raise ValueError('Incomplete real routing/class coverage')
    for row in records:
        before,after=row['before'],row['after']
        for field in ['points','edgeIndexes','maneuvers','distanceMeters','durationSeconds','visualProtectedPoints']:
            if before[field]!=after[field]:raise ValueError('Reference pricing altered navigation: '+field)
        if after['tollAmount'] is None:raise ValueError('Unpriced actual graph route')
        if after['referenceTollMeters']>0:
            if after['tollPricing']!='estimate' or after['tollPricingConfidence']!='low' or after['tollAmount']<=0:raise ValueError('Incorrect reference confidence or fake zero')
        tokens=re.sub(r'\s+','',row['id']).upper().replace('/',';').replace(',',';').split(';')
        if row['vehicleClass'] in (3,4) and 'A41' in tokens:
            if after['tollAmount']!=0 or after['tollPricing']!='exact':raise ValueError('A41 heavy exemption was not applied to the actual graph traversal')
    result['scope']='SHA-verified real Portugal graph; directed road probes and four city trips for classes 1-4. Not Android Location or GPS replay.'
    result['verifiedGraphFiles']=entries
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False)+'\n')
    print(json.dumps({'realRoadReferences':result['roadReferences'],'realRouteClassCases':len(records),'navigationUnchanged':True,'scope':result['scope']}))
