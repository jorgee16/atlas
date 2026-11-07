#!/usr/bin/env python3
"""Audit public issue-2 route candidates against actual graph/catalog hashes.

All native search candidates are retained, including candidates the Android
diversity filter may reject. No personal GPS position or simulator quote is used.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FILES = ['nodes.bin','edges.bin','geometry.bin','roads.bin','strings.bin','restrictions.bin','spatial-index.bin']


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def audit(binary, graph, output):
    assets = ROOT / 'android/native-app/src/main/assets'
    bindings = assets / 'toll-bindings/Portugal/mainland.csv'
    bound = dict(s[1:].strip().split('=',1) for s in bindings.read_text().splitlines() if s.startswith('#') and '=' in s)
    hashes = {name:digest(graph/name) for name in FILES}
    if any(bound.get('graph.'+name)!=value for name,value in hashes.items()):
        raise ValueError('Loaded graph differs from the reviewed country proof')
    output.mkdir(parents=True, exist_ok=True)
    actual = output / 'actual-graph-digests.csv'
    actual.write_text(''.join(name+';'+value+'\n' for name,value in hashes.items()))
    catalogs = {}
    for kind in ('tolls','toll-charges','toll-fares'):
        path = assets / kind / 'Portugal.csv'
        metadata = dict(s[1:].strip().split('=',1) for s in path.read_text().splitlines() if s.startswith('#') and '=' in s)
        catalogs[kind] = dict(sha256=digest(path), metadata=metadata)
    with (output/'routes.jsonl').open('w') as stream:
        subprocess.run([str(binary.resolve()),str(graph.resolve()),str(assets),str(actual.resolve())],stdout=stream,check=True)
    rows = [json.loads(s) for s in (output/'routes.jsonl').read_text().splitlines()]
    if len(rows)!=40 or len({r['id'] for r in rows})!=40:
        raise ValueError('Missing public origins or native route candidates')
    baseline=json.loads((ROOT/'docs/data/issue-2/baseline-summary.json').read_text())
    old={row['id']:row for row in baseline['cases']}
    summary = []
    for row in rows:
        before,after=row['before'],row['after']
        for field in ('points','edgeIndexes','maneuvers','distanceMeters','durationSeconds','visualProtectedPoints'):
            if before.get(field)!=after.get(field):
                raise ValueError('Pricing changed authoritative navigation: '+row['id']+' / '+field)
        fields=('points','edgeIndexes','maneuvers','distanceMeters','durationSeconds','visualProtectedPoints')
        navhash=hashlib.sha256(json.dumps({k:after.get(k) for k in fields},sort_keys=True,separators=(',',':')).encode()).hexdigest()
        changed=navhash!=old[row['id']]['navigationSha256']
        if changed and not row['id'].endswith('/avoid'):
            raise ValueError('Ordinary routing changed from the Release baseline: '+row['id'])
        unknown=[v for v in row['legs'] if not v['covered']]
        summary.append(dict(id=row['id'],distanceMeters=after['distanceMeters'],
            rawPricing=after['tollPricing'],rawAmount=after['tollAmount'],
            navigationSha256=navhash,navigationChangedFromRelease=changed,
            evidenceStatus=after['tollEvidenceStatus'],pricingReason=after['tollPricingReason'],
            proofComplete=row['complete'],unreviewedEdges=len(unknown),firstBlockers=unknown[:5],
            verifiedEvents=row['events'],rejectionReason=row['rejectionReason'],
            androidPrefilterWouldReject=row['androidPrefilterWouldReject'],
            freeConfidence='verified' if after.get('tollFreeVerified') else 'unverified'))
    report=dict(scope='Eight PUBLIC origins and forty real C++ search candidates; not all are accepted Android alternatives. Not the reporter GPS origin.',
        graphDigests=hashes,bindingSha256=digest(bindings),catalogs=catalogs,
        rawCandidateCounts=dict(Counter(r['rawPricing'] for r in summary)),
        recommendedCounts=dict(Counter(r['rawPricing'] for r in summary if r['id'].endswith('/recommended'))),
        navigationUnchangedByPricing=True,ordinaryNavigationUnchangedFromRelease=True,
        intentionalAvoidanceRouteChanges=[r['id'] for r in summary if r['navigationChangedFromRelease']],cases=summary)
    (output/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,required=True)
    parser.add_argument('--graph',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report=audit(args.binary,args.graph,args.output)
    print(json.dumps({k:report[k] for k in ('rawCandidateCounts','recommendedCounts','ordinaryNavigationUnchangedFromRelease')}))
