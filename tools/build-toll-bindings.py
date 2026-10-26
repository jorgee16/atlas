#!/usr/bin/env python3
"""Certify only graph edges identical to reviewed original directed OSM geometry.
No prices are embedded; the configuration links physical points to tariff IDs.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import mmap
from pathlib import Path
import re
import struct

ROOT=Path(__file__).resolve().parents[1]
FILES=['nodes.bin','edges.bin','geometry.bin','roads.bin','strings.bin','restrictions.bin','spatial-index.bin']
def f32(n): return struct.unpack('<f',struct.pack('<f',n))[0]
def coordinate(p): return (f32(p[0]),f32(p[1]))
def u32(b,o): return struct.unpack_from('<I',b,o)[0]
def point(b,o): return struct.unpack_from('<ff',b,o)
def distance(a,b):
    r=math.pi/180;x=math.sin((b[0]-a[0])*r/2);y=math.sin((b[1]-a[1])*r/2)
    h=min(1,max(0,x*x+math.cos(a[0]*r)*math.cos(b[0]*r)*y*y))
    return 12742000*math.atan2(math.sqrt(h),math.sqrt(1-h))
def refs(text): return [re.sub(r'\s+','',x).upper() for x in re.split('[;,/]',text)]

def source_path(a,b,adjacency,tolerance):
    """Unique original directed path inside a simplified segment's corridor.
    Both endpoints must be identical source vertices. Never nearest-road match.
    Ambiguous branches, reversed progress and shortcuts beyond the packager's
    documented simplification error are rejected.
    """
    scale=math.cos(a[0]*math.pi/180)*111320
    dx=(b[1]-a[1])*scale;dy=(b[0]-a[0])*111320
    length2=dx*dx+dy*dy
    if length2<=0: return None
    def projection(p):
        x=(p[1]-a[1])*scale;y=(p[0]-a[0])*111320
        t=(x*dx+y*dy)/length2
        return t,math.hypot(x-t*dx,y-t*dy)
    pending=[([a],0.)];found=[];visits=0
    while pending:
        path,progress=pending.pop();visits+=1
        if visits>4096: return None
        for node in adjacency.get(path[-1],()):
            if node in path: continue
            t,error=projection(node)
            if t<progress-1e-9 or t>1+1e-9 or error>tolerance: continue
            extended=path+[node]
            if node==b:
                found.append(extended)
                if len(found)>1: return None
            else: pending.append((extended,t))
    return found[0] if found else None

def quantization_radius(p):
    # Half of a float32 cell diagonal in metres; include source and graph
    # quantization when comparing against the packager's original-double bound.
    def ulp(value):
        bits=struct.unpack('<I',struct.pack('<f',abs(value)))[0]
        return struct.unpack('<f',struct.pack('<I',bits+1))[0]-abs(value)
    return math.hypot(ulp(p[0])*111320,ulp(p[1])*111320*math.cos(p[0]*math.pi/180))/2

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True);parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    config=json.loads(args.config.read_text());source=json.loads(args.source.read_text())
    nodes={int(k):coordinate(v) for k,v in source['coordinates'].items()}
    charge_ids={int(k):v for k,v in config['chargePoints'].items()}
    if len(set(nodes[n] for n in charge_ids))!=len(charge_ids): raise ValueError('Ambiguous physical charge points')
    pairs=set();source_charge_ids=set();tags={e['id']:e.get('tags',{}) for e in source['elements'] if e['type']=='node'}
    for way in (w for w in source['elements'] if w['type']=='way'):
        t=way['tags']
        if config['road'] not in refs(t.get('ref','')) or t.get('highway')!='motorway': continue
        ids=way['nodes'];direction=t.get('oneway','yes')
        if direction not in ['yes','1','true','-1','no','0','false']: continue
        for n in ids:
            if tags.get(n,{}).get('barrier')=='toll_booth' or tags.get(n,{}).get('highway')=='toll_gantry': source_charge_ids.add(n)
        for a,b in zip(ids,ids[1:]):
            pa,pb=nodes[a],nodes[b]
            if pa==pb: continue
            if direction!='-1': pairs.add((pa,pb))
            if direction in ['-1','no','0','false']: pairs.add((pb,pa))
    adjacency={}
    for a,b in pairs: adjacency.setdefault(a,set()).add(b)
    simplification=float(config['geometrySimplificationMeters'])
    if not 0<=simplification<=2.0: raise ValueError('Unsupported graph simplification bound')
    if source_charge_ids!=set(charge_ids): raise ValueError('Reviewed source does not cover every main-carriageway charge point')
    catalog=json.loads((ROOT/'android/native-app/src/main/assets/regions.json').read_text())
    region=next(r for r in catalog['regions'] if r['id']==config['region'])
    if region['country']!=config['country']: raise ValueError('Country mismatch')
    entries=[e for e in region['package']['files'] if f"/routing/{config['partition']}/" in e['url'] and e['url'].rsplit('/',1)[1] in FILES]
    if len(entries)!=7: raise ValueError('Complete graph identity required')
    spec=importlib.util.spec_from_file_location('graph_audit',ROOT/'tools/audit-toll-graph.py');download=importlib.util.module_from_spec(spec);spec.loader.exec_module(download)
    cache=ROOT/'.toll-binding-graph';cache.mkdir(exist_ok=True)
    paths={e['url'].rsplit('/',1)[1]:download.fetch(e,cache)[1] for e in entries}
    streams={name:path.open('rb') for name,path in paths.items()}
    maps={name:mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ) for name,stream in streams.items()}
    try:
        n,e,g,r,s=[maps[name] for name in ['nodes.bin','edges.bin','geometry.bin','roads.bin','strings.bin']]
        for b,magic in [(n,b'RNOD'),(e,b'REDG'),(g,b'RGEO'),(r,b'RROD'),(s,b'RSTR')]:
            if b[:4]!=magic or u32(b,4)!=6: raise ValueError('Unsupported graph format')
        source_vertices={p for pair in pairs for p in pair}
        eligible_nodes=bytearray(u32(n,8))
        for node in range(u32(n,8)):
            eligible_nodes[node]=point(n,16+node*12) in source_vertices
        arcpoints=24+u32(g,8)*8;start=20+(u32(e,8)+1)*4
        covered=[];bindings=[];matched=set();candidate_count=0;edge_info={};diagnostics=[]
        source_from=0
        gate_coords={nodes[node]:(node,charge) for node,charge in charge_ids.items()}
        for edge in range(u32(e,12)):
            at=start+edge*20;target,dm,attrs,geometry,road=struct.unpack_from('<IIIII',e,at)
            if not geometry&0x20000000: continue
            # Road names/link flags may differ between graph vintages. Only
            # original directed geometry certifies coverage, never those labels.
            while source_from+1<u32(n,8) and u32(e,20+(source_from+1)*4)<=edge: source_from+=1
            if not eligible_nodes[source_from] or not eligible_nodes[target]: continue
            candidate_count+=1
            arc=geometry&0x1fffffff;off,count=struct.unpack_from('<II',g,24+arc*8)
            shape=[point(g,arcpoints+(off+i)*8) for i in range(count)]
            if geometry&0x80000000: shape.reverse()
            shape=[point(n,16+source_from*12)]+shape+[point(n,16+target*12)]
            shape=[p for i,p in enumerate(shape) if i==0 or p!=shape[i-1]]
            if any(distance(p,q)<300 for p in shape for q in gate_coords):
                diagnostics.append({'edge':edge,'from':source_from,'to':target,'graphPolyline':shape})
            if len(shape)<2: continue
            original=[shape[0]]
            for a,b in zip(shape,shape[1:]):
                tolerance=simplification+2*max(quantization_radius(a),quantization_radius(b))
                chain=source_path(a,b,adjacency,tolerance)
                if chain is None: break
                original.extend(chain[1:])
            else:
                # Gates removed by Douglas–Peucker are recovered from the
                # original uniquely witnessed source path, not projected onto
                # a nearby road. Navigation geometry remains untouched.
                shape=original
                total=sum(distance(a,b) for a,b in zip(shape,shape[1:]));length=dm/10
                if total<=0 or length<=0: continue
                covered.append(edge);edge_info[edge]=(source_from,target,length);along=0
                for i,p in enumerate(shape):
                    if i: along+=distance(shape[i-1],p)
                    if p not in gate_coords or i==len(shape)-1: continue
                    node,charge=gate_coords[p];matched.add(node)
                    bindings.append({'edge':edge,'from':source_from,'to':target,'offset':along/total*length,'length':length,'chargeId':charge,'osmNodeId':node,'graphRoadFlags':u32(r,16+road*36+32),'sourcePathVertices':len(shape)})
                continue
            continue
        print('A5_BINDING_MATCH_DIAGNOSTIC='+json.dumps({'matched':sorted(matched),'missing':sorted(set(charge_ids)-matched),'candidateEdges':candidate_count,'certifiedEdges':len(covered),'bindings':bindings}))
        if matched!=set(charge_ids):
            print('A5_GRAPH_GEOMETRY_DIAGNOSTIC='+json.dumps({'sourceChargeCoordinates':{k:nodes[k] for k in charge_ids},'nearbyEdges':diagnostics}))
        if matched!=set(charge_ids): raise ValueError('The loaded graph does not prove every reviewed charge point: '+str(set(charge_ids)-matched))
        if not covered or not bindings: raise ValueError('No certified directed graph coverage')
        identity={e['url'].rsplit('/',1)[1]:e['sha256'] for e in entries}
        graphdir=ROOT/'.toll-binding-graph/graph';graphdir.mkdir(exist_ok=True)
        for name,path in paths.items():
            link=graphdir/name
            if link.is_symlink() or link.exists(): link.unlink()
            link.symlink_to(path.resolve())
        (args.output.parent/'actual-graph-digests.csv').write_text(''.join(name+';'+identity[name]+'\n' for name in FILES))
        forward={};backward={}
        for edge,(a,b,length) in edge_info.items():
            forward.setdefault(a,[]).append((b,edge,length));backward.setdefault(b,[]).append((a,edge,length))
        def walk(start,adj,meters):
            node=start;seen=set();along=0
            while along<meters:
                options=[x for x in adj.get(node,[]) if x[1] not in seen]
                if not options: break
                other,edge,length=sorted(options,key=lambda x:x[1])[0]
                seen.add(edge);node=other;along+=length
            return node
        cases=['id;fromLat;fromLon;toLat;toLon;class;expectedPricing;expectedAmount']
        def case(name,a,b,klass,expected):
            pa,pb=point(n,16+a*12),point(n,16+b*12)
            if a==b: raise ValueError('Proof requires a nonempty real route')
            cases.append(';'.join([name,str(pa[0]),str(pa[1]),str(pb[0]),str(pb[1]),str(klass),'exact',str(expected)]))
        expected_prices={int(k):v for k,v in config["validationExpectedPrices"].items()}
        for i,binding in enumerate(bindings):
            before=walk(binding['from'],backward,500);after=walk(binding['to'],forward,500)
            for klass,expected in expected_prices.items(): case(f'plaza-{i}-class-{klass}',before,after,klass,expected)
            passed=walk(binding['to'],forward,50);later=walk(passed,forward,500)
            case(f'after-plaza-{i}',passed,later,1,0)
        cases.append('unreviewed-city-approaches;38.7223;-9.1393;38.6979;-9.4217;1;fallback;null')
        (args.output.parent/'real-route-cases.csv').write_text('\n'.join(cases)+'\n')
        lines=['# atlas-toll-crossing-bindings-v1' ,'# country='+config['country'],'# reviewed=true']
        lines+=['# graph.'+name+'='+identity[name] for name in FILES]
        lines+=['# osmSourceSha256='+source['sourceSha256'],'# tariffSourceSha256='+config['priceSourceSha256'],
            'kind;edge;from;to;offsetMeters;edgeLengthMeters;chargeId']
        lines+=['coverage;'+str(edge)+';;;;;' for edge in covered]
        lines+=['crossing;{edge};{from};{to};{offset:.9f};{length:.1f};{chargeId}'.format(**b) for b in bindings]
        text='\n'.join(lines)+'\n';args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(text)
        report={'config':config,'graphDigests':identity,'sourceOsmSha256':source['sourceSha256'],'candidateMainlineEdges':candidate_count,
            'certifiedDirectedEdges':len(covered),'bindings':bindings,'sha256':hashlib.sha256(text.encode()).hexdigest()}
        args.output.with_suffix('.audit.json').write_text(json.dumps(report,indent=2)+'\n')
        print('A5_BINDING_REPORT='+json.dumps(report));print('A5_BINDING_CSV='+json.dumps(text))
        print('A5_BINDING_CASES='+json.dumps('\n'.join(cases)+'\n'))
    finally:
        for b in maps.values(): b.close()
        for stream in streams.values(): stream.close()
