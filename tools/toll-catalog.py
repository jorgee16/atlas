#!/usr/bin/env python3
"""Build immutable country table payloads. Publication is a separate validated step."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import quote


def package(source, output):
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
    if not metadata['source'].startswith('https://') or metadata.get('scheme', 'road-average') != 'road-average':
        raise ValueError('Invalid provenance/scheme')
    digits = metadata.get('fractionDigits', '2')
    if not re.fullmatch('[0-3]', digits):
        raise ValueError('Invalid currency precision')
    header, *sections = rows
    if header[:3] != ['road','section','km'] or not 1 <= len(header[3:]) <= 32 or not sections:
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
        road = ''.join(row[0].split()).upper()
        identity = (road, row[1])
        if identity in seen:
            raise ValueError('Duplicate section')
        seen.add(identity)
        roads.add(road)
        for index, value in enumerate(row[2:]):
            if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', value) or not 0 <= float(value) <= 1e9 or (index == 0 and float(value) == 0):
                raise ValueError('Invalid price/length')
    allowed = metadata.get('estimateRoads')
    if allowed is not None and any(''.join(r.split()).upper() not in roads for r in allowed.split(',') if r.strip()):
        raise ValueError('Invalid estimate policy')
    revision = int(metadata['version'])
    path = f'/toll-tariffs/{quote(country, safe="")}/{revision}/table.csv'
    manifest = dict(schemaVersion=1, country=country, revision=revision, currency=metadata['currency'],
        year=int(metadata['year']), fractionDigits=int(digits), vehicleClasses=classes,
        sizeBytes=len(data), sha256=hashlib.sha256(data).hexdigest(), path=path,
        source=metadata['source'], pricing='road-average-estimate', sectionCount=len(sections))
    destination = output/'toll-tariffs'/country
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
    args = parser.parse_args()
    for table in sorted(args.source.glob('*.csv')):
        print(json.dumps(package(table, args.output), ensure_ascii=False))
