#!/usr/bin/env python3
"""Extract the published origin/destination matrix by PDF cell coordinates.
No symmetry, missing-cell zero, per-km interpolation or section sums are inferred.
"""
import argparse
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
from statistics import median

STATION=re.compile(r'^(?:A\d+(?:-\d+)?\s+)?(\d{4})\s*[:–-]\s*(.*)$')
PRICE=re.compile(r'^(\d+,\d{2})\s*€$')

def extract_page(spans):
    horizontal=[s for s in spans if s['dir'][0]>.9]
    columns=sorted([s for s in spans if s['dir'][1]<-.9 and STATION.fullmatch(s['text'].strip())],key=lambda s:s['bbox'][2])
    rows=sorted([s for s in horizontal if STATION.fullmatch(s['text'].strip())],key=lambda s:s['bbox'][1])
    if not columns or not rows: raise ValueError('Missing explicit station row/column identities')
    marker_x=min(r['bbox'][0] for r in rows)
    classes=sorted({int(s['text']) for s in horizontal if re.fullmatch('[1-4]',s['text']) and s['bbox'][2]<marker_x})
    groups=[];seen=set()
    for row in rows:
        identity=STATION.fullmatch(row['text'].strip()).group(1)
        if identity in seen: groups.append([]);seen=set()
        if not groups: groups.append([])
        groups[-1].append(row);seen.add(identity)
    if len(classes)!=len(groups): raise ValueError(f'Ambiguous class blocks: {classes}, {len(groups)} row groups')
    row_classes={id(row):vehicle for group,vehicle in zip(groups,classes) for row in group}
    result=[];stations={}
    for s in columns+rows:
        code,name=STATION.fullmatch(s['text'].strip()).groups()
        if name not in stations.setdefault(code,[]): stations[code].append(name)
    column_gap=median(b['bbox'][2]-a['bbox'][2] for a,b in zip(columns,columns[1:]))
    row_gap=median(b['bbox'][1]-a['bbox'][1] for a,b in zip(rows,rows[1:]))
    occupied=set()
    for span in horizontal:
        match=PRICE.fullmatch(span['text'].strip())
        if not match: continue
        x=span['bbox'][2];y=(span['bbox'][1]+span['bbox'][3])/2
        col=sorted(columns,key=lambda s:abs(s['bbox'][2]-x))
        row=sorted(rows,key=lambda s:abs((s['bbox'][1]+s['bbox'][3])/2-y))
        dx=abs(col[0]['bbox'][2]-x);dy=abs((row[0]['bbox'][1]+row[0]['bbox'][3])/2-y)
        if dx>column_gap/4 or dy>row_gap/3: raise ValueError(f'Price outside source cell bounds: dx={dx}, dy={dy}, column={col[0]}, row={row[0]}, price={span}')
        if len(col)>1 and abs(col[1]['bbox'][2]-x)<=dx+1: raise ValueError('Ambiguous destination column')
        if len(row)>1 and abs((row[1]['bbox'][1]+row[1]['bbox'][3])/2-y)<=dy+1: raise ValueError('Ambiguous origin row')
        origin=STATION.fullmatch(row[0]['text'].strip()).group(1)
        destination=STATION.fullmatch(col[0]['text'].strip()).group(1)
        vehicle=row_classes[id(row[0])];identity=(origin,destination,vehicle)
        if identity in occupied: raise ValueError('Duplicate fare cell')
        occupied.add(identity);result.append((origin,destination,vehicle,Decimal(match.group(1).replace(',','.'))))
    if not result: raise ValueError('No published fare cells')
    return result,stations

if __name__=='__main__':
    import pymupdf
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('pdf',type=Path);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    data=args.pdf.read_bytes()
    source_sha=hashlib.sha256(data).hexdigest()
    if source_sha!='dca8323f964ff6702a984a1afa1737a3a32cac1b21934b46ca1d0924e0b26274':
        raise ValueError('Official PDF changed; review identities, layout and effective dates first')
    document=pymupdf.open(stream=data,filetype='pdf')
    if len(document)!=13: raise ValueError('Source layout changed; review is mandatory')
    fares=defaultdict(dict);stations={};counts=[];dates={}
    for index,page in enumerate(document):
        if index==12: continue  # The open-system table is a different scheme.
        spans=[{'text':s['text'],'bbox':s['bbox'],'dir':line['dir']} for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for s in line['spans']]
        try: cells,names=extract_page(spans)
        except ValueError as error: raise ValueError(f'Page {index+1}: {error}') from error
        print('BRISA_PAGE_VERIFIED='+json.dumps({'page':index+1,'cells':len(cells)}),flush=True)
        domain='north' if index<4 else 'center' if index<8 else 'south' if index<10 else 'brisal'
        for a,b,vehicle,price in cells:
            key=(domain,a,b)
            if vehicle in fares[key]: raise ValueError('Duplicate source class cell across pages')
            fares[key][vehicle]=price
        for code,aliases in names.items():
            for name in aliases:
                if name not in stations.setdefault(code,[]): stations[code].append(name)
        effective=re.findall(r'Taxas em vigor desde (\d{2}-\d{2}-\d{4})',page.get_text())
        if len(effective)!=1: raise ValueError('Missing/ambiguous source effective date')
        dates.setdefault(domain,set()).add(effective[0])
        counts.append({'page':index+1,'effectiveDate':effective[0],'classes':sorted({r[2] for r in cells}),'cells':len(cells)})
    if any(set(values)!={1,2,3,4} for values in fares.values()): raise ValueError('Incomplete classes; do not fill missing fares')
    lines=['# atlas-toll-fares-candidate-v1','# country=Portugal','# currency=EUR','# year=2026','# version=2026102601','# fractionDigits=2','# scheme=entry-exit',
        '# source=https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_25082026_v7.pdf',
        '# status=unreviewed-route-bindings-not-for-publication','# sourceSha256='+source_sha,
        '# sourceEffectiveDates='+json.dumps({k:sorted(v) for k,v in dates.items()},sort_keys=True,separators=(',',':')),'network;entry;exit;class1;class2;class3;class4']
    for (domain,a,b),prices in sorted(fares.items()): lines.append(';'.join(['bcr-'+domain,a,b]+[f'{prices[v]:.2f}' for v in [1,2,3,4]]))
    args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text('\n'.join(lines)+'\n')
    report={'status':'candidate-not-active-in-routing','sourceEffectiveDates':{k:sorted(v) for k,v in dates.items()},'warnings':['South pages state 01-01-2025 in the current August 2026 PDF; operator clarification remains required','Physical entry/exit graph bindings are not nationally validated'],'sourceSha256':source_sha,'farePairs':len(fares),'stations':stations,'pages':counts,'csvSha256':hashlib.sha256(args.out.read_bytes()).hexdigest()}
    args.out.with_suffix('.audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('NATIONAL_BRISA_FARES_REPORT='+json.dumps(report,ensure_ascii=False))
