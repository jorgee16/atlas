#!/usr/bin/env python3
"""Compile an explicit station review into source-way evidence, never prices.

Run only against the pinned OSM captures described by the station review.
Directed connectivity establishes entry/exit; proximity alone never does.
The independent graph compiler must still witness every physical node once.
"""
import argparse
from collections import defaultdict, deque
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'tools/toll-binding-config'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collection_nodes(elements, approved):
    captured={e['id'] for e in elements if e['type']=='node'
              and (e.get('tags',{}).get('barrier')=='toll_booth'
                   or e.get('tags',{}).get('highway')=='toll_gantry')}
    if approved is None or len(set(approved))!=len(approved) or set(approved)-captured:
        raise ValueError('Explicit reviewed collection nodes differ from captured source')
    return captured,approved


def station_paths(gate, adjacency, targets, collection_nodes):
    """All directed station branches to the mainline, excluding other booths."""
    queue=deque([(gate,0)]); seen={gate}; links=[]; ends=set()
    while queue:
        node,depth=queue.popleft()
        if node!=gate and node in targets:
            ends.add(node);continue
        if depth>=600: continue
        for nxt,wid in adjacency.get(node,[]):
            if nxt in collection_nodes and nxt!=gate: continue
            links.append((node,nxt,wid))
            if nxt not in seen:
                seen.add(nxt);queue.append((nxt,depth+1))
    if not ends: return None
    predecessors=defaultdict(list)
    for a,b,wid in links: predecessors[b].append(a)
    useful=set(ends);queue=deque(ends)
    while queue:
        for previous in predecessors[queue.popleft()]:
            if previous not in useful:
                useful.add(previous);queue.append(previous)
    return tuple((a,b,wid) for a,b,wid in links if a in useful and b in useful)


def prepare(review_path, raw_dir, relation_path, output):
    review = json.loads(review_path.read_text())
    identities=[s['id'] for s in review['stations']]
    if (review.get('schemaVersion')!=1 or review.get('reviewed') is not True
            or len(set(identities))!=len(identities)
            or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',v) for v in identities)
            or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',review['network'])
            or not review.get('country') or review['southLatitude']>=review['northLatitude']):
        raise ValueError('Invalid or unreviewed station identities')
    elements = {}
    captures = []
    def ingest(path):
        data = json.loads(path.read_text())
        for e in data['elements']:
            elements[e['type'], e['id']] = e
        captures.append({'file': path.name, 'sha256': sha(path)})
        return data
    relation = ingest(relation_path)
    main = {e['id']: e for e in relation['elements'] if e['type']=='way'
            and e.get('tags', {}).get('highway')=='motorway'}
    station_gates = {}
    captured_collection_nodes = set()
    for station in review['stations']:
        data = ingest(raw_dir / station['capture'])
        captured,gates=collection_nodes(data['elements'],station.get('collectionNodeIds'))
        captured_collection_nodes.update(captured)
        station_gates[station['id']] = gates
    coords = {k[1]: (e['lat'], e['lon']) for k,e in elements.items() if k[0]=='node'}
    ways = {k[1]: e for k,e in elements.items() if k[0]=='way'
            and (e.get('tags', {}).get('highway') in ('motorway','motorway_link')
                 or k[1] in review.get('boundaryWayIds',[]))
            and e.get('tags', {}).get('oneway')=='yes'
            and e.get('tags', {}).get('access') not in ('no','private')}
    # The southern scope boundary is an open, unobserved continuation: trips
    # beyond the reviewed corridor cannot become complete or a free journey.
    selected = {wid for wid,w in main.items() if any(
        review['southLatitude'] <= coords[n][0] <= review['northLatitude'] for n in w['nodes'])}
    targets = {n for wid in selected for n in ways[wid]['nodes']}
    all_gates = captured_collection_nodes
    forward, backward = defaultdict(list), defaultdict(list)
    for wid,w in ways.items():
        for a,b in zip(w['nodes'],w['nodes'][1:]):
            forward[a].append((b,wid)); backward[b].append((a,wid))
    def path(gate, adjacency):
        return station_paths(gate,adjacency,targets,all_gates)
    charges, evidence = {}, []
    for station in review['stations']:
        accepted=[]
        diagnostics=[]
        for gate in station_gates[station['id']]:
            if station.get('terminal') and not any(gate in w['nodes'] for w in main.values()):
                continue
            f,b=path(gate,forward),path(gate,backward)
            diagnostics.append((gate, f is not None, b is not None))
            if station.get('terminal'):
                containing=[w for w in ways.values() if gate in w['nodes']]
                if len(containing)!=1: raise ValueError('Ambiguous terminal way')
                w=containing[0]
                role='exit' if coords[w['nodes'][-1]][0]>coords[w['nodes'][0]][0] else 'entry'
                selected.add(w['id'])
            elif str(gate) in station.get('nodeRoles',{}):
                role=station['nodeRoles'][str(gate)]
                trail=f if role=='entry' else b if role=='exit' else None
                if trail is None: raise ValueError('Reviewed direction lacks a source path')
                selected.update(v[2] for v in trail)
            elif (f is None)==(b is None):
                continue
            else:
                role='entry' if f is not None else 'exit'
                selected.update(v[2] for v in (f if f is not None else b))
            # A booth at a source-way split belongs to its outgoing graph
            # interval. Keep both original ways, including the free side.
            selected.update(wid for wid,w in ways.items() if gate in w['nodes'])
            charges[str(gate)]=role+':'+review['network']+':'+station['id']
            accepted.append({'node':gate,'role':role,'coordinate':coords[gate]})
        if {g['role'] for g in accepted}!={'entry','exit'}:
            raise ValueError('Station lacks directed entry/exit proof: '+station['id']+' '+str(diagnostics))
        evidence.append(dict(station,physicalNodes=accepted))
    selected.update(review.get('freeApproachWayIds',[]))
    used_nodes={n for wid in selected for n in ways[wid]['nodes']}
    candidates=[elements['node',n] for n in used_nodes if
        elements['node',n].get('tags',{}).get('barrier')=='toll_booth' or
        elements['node',n].get('tags',{}).get('highway')=='toll_gantry']
    if {e['id'] for e in candidates} != {int(n) for n in charges}:
        raise ValueError('Unmapped collection node on selected source ways')
    source={'schemaVersion':1,'country':review['country'],
        'attribution':'OpenStreetMap contributors, ODbL 1.0', 'captures':captures,
        'ways':[{k:ways[wid][k] for k in ('id','version','timestamp','nodes','tags')} for wid in sorted(selected)],
        'coordinates':{str(n):coords[n] for n in sorted(used_nodes)},
        'chargeCandidates':[{'id':e['id'],'lat':e['lat'],'lon':e['lon'],'tags':e['tags']} for e in sorted(candidates,key=lambda e:e['id'])]}
    source_path=output.with_name(output.stem+'.source.json')
    source_path.write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
    paid={}
    for wid in selected:
        if wid in review.get('freeApproachWayIds',[]): continue
        w=ways[wid];bound={}
        for n in w['nodes']:
            event=charges.get(str(n))
            if event: bound['beginNode' if event.startswith('entry:') else 'endNode']=n
        paid[str(wid)]=bound
    chains=review.get('directedChains',[])
    for chain in chains: paid['chain:'+'+'.join(map(str,chain['wayIds']))]={}
    config={'schemaVersion':1,'country':review['country'],'reviewed':True,'reviewedOn':review['reviewedOn'],
        'geometrySimplificationMeters':2.0,'allowedHighways':['motorway','motorway_link','trunk'],
        'sourceSha256':sha(source_path),'seedSha256':review['seedSha256'],
        'wayIds':sorted(selected),'directedChains':chains,'chargePoints':charges,
        'network':review['network'],'networkRanges':paid,
        'scope':review['scope'],'stationEvidence':evidence,'stationReviewSha256':sha(review_path)}
    output.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    return config


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--review',type=Path,required=True);p.add_argument('--raw-dir',type=Path,required=True)
    p.add_argument('--relation',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();r=prepare(a.review,a.raw_dir,a.relation,a.output)
    print('Selected',len(r['wayIds']),'ways and',len(r['chargePoints']),'directed station nodes')
