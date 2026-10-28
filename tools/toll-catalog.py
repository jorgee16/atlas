#!/usr/bin/env python3
"""Build immutable country table payloads. Publication is a separate validated step."""
import argparse
import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote


def package(source, output, namespace="toll-tariffs"):
    data = source.read_bytes()
    if not 0 < len(data) <= 2 * 1024 * 1024:
        raise ValueError('Invalid tariff size')
    metadata = {}
    rows = []
    for raw in data.decode('utf-8').splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#'):
            if '=' in line:
                key, value = line[1:].split('=', 1)
                if key.strip() in metadata:
                    raise ValueError('Duplicate metadata')
                metadata[key.strip()] = value.strip()
        else:
            rows.append([x.strip() for x in line.split(';')])
    country = metadata['country']
    if not re.fullmatch(r'[A-Za-z][A-Za-z -]{1,64}', country) or country != source.stem:
        raise ValueError('Invalid country filename')
    if not re.fullmatch(r'[1-9][0-9]{0,15}', metadata['version']):
        raise ValueError('Invalid revision')
    if not re.fullmatch(r'[A-Z]{3}', metadata['currency']) or not re.fullmatch(r'[0-9]{4}', metadata['year']):
        raise ValueError('Invalid currency/year')
    scheme=metadata.get('scheme','road-average')
    fixed=scheme=='fixed-crossing';ticket=scheme=='entry-exit'
    if metadata.get('status','active')!='active': raise ValueError('Unapproved tariff candidate')
    if scheme not in ('road-average','fixed-crossing','entry-exit') or not metadata['source'].startswith('https://'):
        raise ValueError('Invalid provenance/scheme')
    digits = metadata.get('fractionDigits', '2')
    if not re.fullmatch('[0-3]', digits):
        raise ValueError('Invalid currency precision')
    header, *sections = rows
    expected=['network','entry','exit'] if ticket else ['charge','road','name'] if fixed else ['road','section','km']
    if header[:3] != expected or not 1 <= len(header[3:]) <= 32 or not 1 <= len(sections) <= 30000:
        raise ValueError('Invalid columns')
    if not all(re.fullmatch(r'class[1-9][0-9]?', c) for c in header[3:]):
        raise ValueError('Invalid classes')
    classes = [int(c[5:]) for c in header[3:]]
    if len(set(classes)) != len(classes):
        raise ValueError('Duplicate classes')
    seen = set()
    roads = set()
    for row in sections:
        if len(row) != len(header) or not row[0] or not row[1]:
            raise ValueError('Invalid section')
        if fixed and (not re.fullmatch('[A-Za-z0-9:_-]{1,128}',row[0]) or not row[2]):
            raise ValueError('Invalid fixed charge')
        if ticket and not all(re.fullmatch('[A-Za-z0-9_-]{1,128}',v) for v in row[:3]): raise ValueError('Invalid entry/exit identity')
        road = ''.join(row[1 if fixed else 0].split()).upper()
        identity = tuple(row[:3]) if ticket else (row[0], '') if fixed else (road,row[1])
        if identity in seen:
            raise ValueError('Duplicate section')
        seen.add(identity)
        roads.add(road)
        for index, value in enumerate(row[3:] if (fixed or ticket) else row[2:]):
            if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', value) or not 0 <= float(value) <= 1e9 or (not fixed and not ticket and index == 0 and float(value) == 0):
                raise ValueError('Invalid price/length')
            if (fixed or ticket) and Decimal(value)*10**int(digits) != (Decimal(value)*10**int(digits)).to_integral_value():
                raise ValueError('Price exceeds currency precision')
    free=metadata.get('freeRoads')
    if free is not None:
        refs=[''.join(r.split()).upper() for r in free.split(',')]
        if fixed or ticket or not metadata.get('freeRoadSource','').startswith('https://') or not refs or len(set(refs))!=len(refs) or any(not re.fullmatch('[A-Z][A-Z0-9-]{0,31}',r) for r in refs):
            raise ValueError('Invalid explicit free-road policy/provenance')
    elif 'freeRoadSource' in metadata: raise ValueError('Free-road source without policy')
    allowed = metadata.get('estimateRoads')
    if (fixed or ticket) and allowed is not None: raise ValueError('Road estimate policy in fixed-charge catalog')
    if namespace!={'road-average':'toll-tariffs','fixed-crossing':'toll-charges','entry-exit':'toll-fares'}[scheme]:
        raise ValueError('Wrong catalog namespace')
    if allowed is not None and any(''.join(r.split()).upper() not in roads for r in allowed.split(',') if r.strip()):
        raise ValueError('Invalid estimate policy')
    class_free=metadata.get('freeRoadClasses')
    if class_free is not None:
        if fixed or ticket or not metadata.get('freeRoadClassSource','').startswith('https://'):raise ValueError('Invalid class exemption provenance')
        used=set()
        for rule in class_free.split('|'):
            pair=rule.split(':')
            if len(pair)!=2:raise ValueError('Invalid class exemption')
            ref=''.join(pair[0].split()).upper();ids=[v.strip() for v in pair[1].split(',')]
            if not re.fullmatch('[A-Z][A-Z0-9-]{0,31}',ref) or ref in used or not ids or len(set(ids))!=len(ids) or any(not re.fullmatch('[1-9][0-9]?',v) or int(v) not in classes for v in ids):raise ValueError('Invalid class exemption road/classes')
            used.add(ref)
    elif 'freeRoadClassSource' in metadata:raise ValueError('Class exemption source without policy')
    if 'referenceEstimate' in metadata:
        if fixed or ticket or metadata['referenceEstimate']!='road-then-country-average' or 'referenceSourceRoads' not in metadata:raise ValueError('Invalid reference policy')
        refs=[''.join(r.split()).upper() for r in metadata['referenceSourceRoads'].split(',')]
        eligible=set(''.join(r.split()).upper() for r in allowed.split(',')) if allowed is not None else roads
        if not refs or len(set(refs))!=len(refs) or any(r not in roads or r not in eligible for r in refs):raise ValueError('Invalid reference source road')
        if not any(''.join(row[0].split()).upper() in refs and any(Decimal(v)>0 for v in row[3:]) for row in sections):raise ValueError('No positive reference rates')
    elif 'referenceSourceRoads' in metadata:raise ValueError('Reference source without policy')
    revision = int(metadata['version'])
    path = f'/{namespace}/{quote(country, safe="")}/{revision}/table.csv'
    manifest = dict(schemaVersion=1, country=country, revision=revision, currency=metadata['currency'],
        year=int(metadata['year']), fractionDigits=int(digits), vehicleClasses=classes,
        sizeBytes=len(data), sha256=hashlib.sha256(data).hexdigest(), path=path,
        source=metadata['source'], pricing=scheme if (fixed or ticket) else 'road-average-estimate', sectionCount=len(sections))
    if fixed: manifest.update(scheme=scheme,chargeCount=len(sections))
    if ticket: manifest.update(scheme=scheme,journeyCount=len(sections))
    destination = output/namespace/country
    version = destination/str(revision)
    version.mkdir(parents=True, exist_ok=True)
    table = version/'table.csv'
    if table.exists() and table.read_bytes() != data:
        raise ValueError('Immutable revision collision')
    table.write_bytes(data)
    text = json.dumps(manifest, ensure_ascii=False, indent=2)+'\n'
    (version/'manifest.json').write_text(text, encoding='utf-8')
    (destination/'manifest.json').write_text(text, encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('android/native-app/src/main/assets/tolls'))
    parser.add_argument('--output', type=Path, default=Path('dist/toll-catalogs'))
    parser.add_argument('--namespace',default='toll-tariffs')
    args = parser.parse_args()
    for table in sorted(args.source.glob('*.csv')):
        print(json.dumps(package(table, args.output,args.namespace), ensure_ascii=False))
