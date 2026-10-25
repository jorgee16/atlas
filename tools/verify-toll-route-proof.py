#!/usr/bin/env python3
"""Check actual native routing results, not a fabricated route or km-based quote."""
import argparse
import json
from pathlib import Path
import subprocess

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',required=True);args=p.parse_args()
    root=Path('toll-section-audit')
    command=[args.binary,'.toll-binding-graph/graph','Portugal',
        'android/native-app/src/main/assets/tolls/Portugal.csv','android/native-app/src/main/assets/toll-charges/Portugal.csv',
        str(root/'Portugal-mainland.csv'),str(root/'actual-graph-digests.csv'),str(root/'real-route-cases.csv')]
    result=subprocess.check_output(command,text=True);(root/'native-real-route-results.json').write_text(result)
    cases=json.loads(result)
    if len(cases)<9: raise ValueError('Insufficient actual route/class/direction/after-gate cases')
    for case in cases:
        before,after=case['before'],case['after']
        for field in ['points','edgeIndexes','maneuvers','distanceMeters','durationSeconds','visualProtectedPoints']:
            if before.get(field)!=after.get(field): raise ValueError('Toll pricing altered navigation: '+field)
        if case['expectedPricing']=='exact':
            if not case['applied'] or after['tollPricing']!='exact' or abs(after['tollAmount']-case['expectedAmount'])>1e-9:
                raise ValueError('Unverified/incorrect actual toll quote: '+json.dumps(case))
        elif case['applied'] or after['tollPricing']=='exact':
            raise ValueError('Unreviewed approaches were incorrectly certified exact')
        print('REAL_TOLL_ROUTE='+json.dumps({'case':case['id'],'pricing':after['tollPricing'],'amount':after['tollAmount'],'vehicleClass':after['tollVehicleClass'],'meters':after['distanceMeters']}))
    print('Verified',len(cases),'actual native A5 route/class/after-plaza and incomplete-coverage cases')
