#!/usr/bin/env python3
"""Validate supplied tariff evidence; promote only explicitly reviewed prices.

This offline adapter never creates graph bindings, infers direction, adds reverse
fares, computes a journey total, or publishes data. Runtime pricing continues to
use the existing country catalogs and directed-crossing proof.
"""
import argparse
from collections import Counter
import csv
from datetime import date
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'docs/data/toll-evidence/Portugal/2026-10-30'
FIELDS = ('id,tipo_registo,concessionaria,via,origem_exata,destino_exato,'
          'itinerario_vias,sentido,classe,preco_eur,moeda,ano_tarifario,'
          'vigencia_inicio,vigencia_fim,data_consulta,entrada,saida,praca,'
          'portico,sublanco,extensao_km,fonte_entidade,fonte_url,documento_ref,'
          'estado_validacao,observacoes').split(',')
KINDS = {'percurso_OD_explicito': 'entry-exit', 'sublanco': 'section',
         'sublanço': 'section', 'portico': 'gantry',
         'praça/sublanço': 'plaza', 'ponte': 'bridge'}
EXEMPTION_FIELDS = ('via,zona_legal,aplicacao,preco_eur,classe,vigencia_inicio,'
                    'fonte_url,observacoes').split(',')


def cents(text):
    if not re.fullmatch(r'[0-9]+\.[0-9]{2}', text):
        raise ValueError('Price must be nonnegative, with exactly two decimal digits')
    value = Decimal(text)
    if value > 1_000_000_000:
        raise ValueError('Price exceeds catalog limit')
    return int(value * 100)


def https(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Invalid source URL')


def table(data, fields):
    reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig'), newline=''))
    if reader.fieldnames != fields:
        raise ValueError('Unexpected evidence columns')
    rows = list(reader)
    if not 0 < len(rows) <= 30_000 or any(None in r or None in r.values() for r in rows):
        raise ValueError('Invalid evidence rows')
    return rows


def load(directory=DEFAULT, country='Portugal'):
    review = json.loads((directory / 'review.json').read_text())
    if (review['schemaVersion'] != 1 or review['country'] != country
            or review['currency'] != 'EUR' or not 2000 <= review['year'] <= 2100
            or not isinstance(review['revision'], int) or review['revision'] <= 0):
        raise ValueError('Cross-country or unsupported evidence metadata')
    original = json.loads((directory / 'manifest.json').read_text())
    if original['version'] != review['sourceBundleVersion']:
        raise ValueError('Wrong source bundle version')
    original_files = {x['name']: x for x in original['files']}
    inputs = {}
    for name in ('tarifas_portagens_2026.csv', 'excecoes_zero_2026.csv'):
        data = (directory / name).read_bytes()
        if not 0 < len(data) <= 2 * 1024 * 1024:
            raise ValueError('Invalid evidence file size')
        digest = hashlib.sha256(data).hexdigest()
        source = original_files[name]
        if digest != review['inputSha256'][name] or digest != source['sha256'] or len(data) != source['bytes']:
            raise ValueError('Evidence integrity mismatch: ' + name)
        inputs[name] = data
    rows = table(inputs['tarifas_portagens_2026.csv'], FIELDS)
    seen = set()
    for row in rows:
        identity = row['id']
        if not re.fullmatch('[a-f0-9]{16}', identity) or identity in seen:
            raise ValueError('Invalid or duplicate source record ID')
        seen.add(identity)
        if row['tipo_registo'] not in KINDS or row['moeda'] != review['currency'] or row['ano_tarifario'] != str(review['year']):
            raise ValueError('Unsupported scheme, currency or year')
        if not re.fullmatch('[1-9][0-9]?', row['classe']):
            raise ValueError('Invalid source vehicle class')
        if any(not row[key].strip() for key in ('concessionaria', 'via', 'origem_exata', 'destino_exato',
                                                'itinerario_vias', 'sentido', 'fonte_entidade', 'documento_ref', 'estado_validacao')):
            raise ValueError('Missing tariff identity/provenance')
        row['amountMinor'] = cents(row['preco_eur'])
        https(row['fonte_url'])
        consulted = date.fromisoformat(row['data_consulta'])
        if consulted > date.today() or consulted > date.fromisoformat(review['checkedOn']):
            raise ValueError('Future source observation')
        start, end = row['vigencia_inicio'], row['vigencia_fim']
        if start:
            date.fromisoformat(start)
        if end:
            date.fromisoformat(end)
        if start and end and start > end:
            raise ValueError('Reversed source validity dates')
        row['scheme'] = KINDS[row['tipo_registo']]
        row['conflict'] = row['estado_validacao'].startswith('CONFLITO_')
        row['vehicleRestriction'] = 'electronic-motorcycle-only' if row['classe'] == '5' else None
        # Published textual direction is not a reviewed graph crossing direction.
        row['geometryReviewed'] = False
        row['directionReviewed'] = False
        row['eligibleForRuntimePricing'] = False
    exemptions = table(inputs['excecoes_zero_2026.csv'], EXEMPTION_FIELDS)
    for row in exemptions:
        if cents(row['preco_eur']) != 0 or not row['zona_legal'] or not row['aplicacao']:
            raise ValueError('Invalid legal exemption evidence')
        https(row['fonte_url'])
        date.fromisoformat(row['vigencia_inicio'])
        row['eligibleForRuntimePricing'] = False
    return review, rows, exemptions


def reviewed_charges(review, rows):
    """Prices only. Approval here cannot certify passage through a toll point."""
    by_id = {r['id']: r for r in rows}
    result = []
    used = set()
    source_groups = set()
    for approval in review['priceReviews']:
        charge = approval['chargeId']
        if not re.fullmatch('[A-Za-z0-9:_-]{1,128}', charge) or charge in used:
            raise ValueError('Invalid or duplicate reviewed charge ID')
        used.add(charge)
        row = by_id[approval['sourceRecordId']]
        expected = {'concessionaria': 'operator', 'via': 'road', 'origem_exata': 'origin',
                    'destino_exato': 'destination', 'fonte_url': 'source', 'tipo_registo': 'kind'}
        if any(row[key] != approval[value] for key, value in expected.items()):
            raise ValueError('Price review does not identify the source exactly')
        if row['scheme'] not in ('gantry', 'plaza') or row['classe'] != '1':
            raise ValueError('Section, bridge or ticket is not a fixed charge')
        if approval['geometryReviewed'] or approval['directionReviewed']:
            raise ValueError('This price adapter cannot approve geographic bindings')
        group = tuple(row[key] for key in expected)
        if group in source_groups:
            raise ValueError('Same source charge promoted twice')
        source_groups.add(group)
        classes = approval['reviewedClasses']
        if classes != [1, 2, 3, 4]:
            raise ValueError('Unsupported class promotion; class 5 requires a restricted provider')
        prices = []
        for vehicle in classes:
            matches = [r for r in rows if r['classe'] == str(vehicle)
                       and all(r[key] == row[key] for key in expected)]
            if len(matches) != 1 or matches[0]['conflict']:
                raise ValueError('Missing, ambiguous or conflicting reviewed class price')
            prices.append(matches[0]['preco_eur'])
        result.append([charge, row['via'], row['origem_exata'] + ' / ' + row['destino_exato']] + prices)
    return result


def catalog_parts(path):
    lines = path.read_text().splitlines()
    metadata = dict(line[1:].strip().split('=', 1) for line in lines if line.startswith('#') and '=' in line)
    data = list(csv.reader([line for line in lines if line and not line.startswith('#')], delimiter=';'))
    return lines, metadata, data[0], data[1:]


def check_catalog(path, review, additions):
    _, metadata, header, current = catalog_parts(path)
    if (metadata['country'] != review['country'] or metadata['currency'] != review['currency']
            or metadata['year'] != str(review['year']) or metadata['scheme'] != 'fixed-crossing'
            or int(metadata['version']) < review['revision']
            or header != ['charge', 'road', 'name', 'class1', 'class2', 'class3', 'class4']):
        raise ValueError('Wrong canonical fixed-price catalog identity')
    by_id = {r[0]: r for r in current}
    if len(by_id) != len(current) or any(by_id.get(r[0]) != r for r in additions):
        raise ValueError('Canonical catalog differs from reviewed source prices')
    if len(current) - len(additions) != review['retainedBrisaCharges']:
        raise ValueError('Unexpected pre-existing charges; review before merging')
    if (metadata.get('source') != review['catalogSource']
            or any(metadata.get('source.' + key) != url for key, url in review['publishedSources'].items())
            or metadata.get('evidenceSha256') != review['inputSha256']['tarifas_portagens_2026.csv']):
        raise ValueError('Mixed-operator source provenance is incomplete')


def update_catalog(path, review, additions):
    lines, metadata, header, current = catalog_parts(path)
    if (metadata['country'] != review['country'] or metadata['currency'] != review['currency']
            or metadata['year'] != str(review['year']) or metadata['scheme'] != 'fixed-crossing'
            or header != ['charge', 'road', 'name', 'class1', 'class2', 'class3', 'class4']):
        raise ValueError('Cannot merge prices into a different country/scheme')
    if int(metadata['version']) > review['revision']:
        raise ValueError('Cannot overwrite a newer tariff revision')
    added_ids = {r[0] for r in additions}
    retained = [r for r in current if r[0] not in added_ids]
    if len(retained) != review['retainedBrisaCharges']:
        raise ValueError('Unexpected retained price coverage')
    comments = [line for line in lines if line.startswith('#')]
    comments = [f'# version={review["revision"]}' if line.startswith('# version=') else line for line in comments]
    for key, value in [('source', review['catalogSource']),
                       *[('source.' + key, url) for key, url in review['publishedSources'].items()],
                       ('evidenceSha256', review['inputSha256']['tarifas_portagens_2026.csv'])]:
        if key != 'evidenceSha256':
            https(value)
        comments = [line for line in comments if not line.startswith('# ' + key + '=')]
        comments.append('# ' + key + '=' + value)
    path.write_text('\n'.join(comments + [';'.join(header)] + [';'.join(r) for r in retained + additions]) + '\n')
    check_catalog(path, review, additions)


def audit(review, rows, exemptions, root=ROOT):
    # Text normalization is solely a source-to-source audit, never graph matching.
    def normalized(text):
        return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower())
    assets = root / 'android/native-app/src/main/assets'
    _, _, _, sections = catalog_parts(assets / 'tolls/Portugal.csv')
    existing = {(r[0], normalized(r[1])): r for r in sections}
    seen = set()
    compared = 0
    for row in rows:
        if row['fonte_entidade'] != 'IMT (tarifário 2026)':
            continue
        key = row['via'], normalized(row['sublanco'])
        current = existing.get(key)
        if current is None or cents(current[2 + int(row['classe'])]) != row['amountMinor']:
            raise ValueError('Existing IMT price differs from supplied observation: ' + row['id'])
        compared += 1
        seen.add(key)
    _, _, _, matrix = catalog_parts(assets / 'toll-fares/Portugal.csv')
    matrix = {tuple(r[:3]): r[3:] for r in matrix}
    od_compared = 0
    for row in rows:
        if row['scheme'] != 'entry-exit':
            continue
        # Published station codes only. Do not derive station IDs from towns/GPS.
        entry, exit_ = row['entrada'].split(':', 1)[0], row['saida'].split(':', 1)[0]
        values = matrix.get(('brisa-published', entry, exit_))
        if values is None or cents(values[int(row['classe']) - 1]) != row['amountMinor']:
            raise ValueError('Existing Brisa fare differs; explicit temporal review required')
        od_compared += 1
    return dict(schemaVersion=1, country=review['country'], year=review['year'], revision=review['revision'],
                sourceRows=len(rows), sourceRoadLabels=sorted({r['via'] for r in rows}),
                schemes=dict(sorted(Counter(r['scheme'] for r in rows).items())),
                classes=dict(sorted(Counter(r['classe'] for r in rows).items())),
                quarantinedConflictRows=sum(r['conflict'] for r in rows),
                restrictedMotorcycleRows=sum(r['vehicleRestriction'] is not None for r in rows),
                legalScopeRecords=len(exemptions), imtClassValuesConsistent=compared,
                brisaDirectedClassValuesConsistent=od_compared,
                retainedSectionsAbsentFromInput=[{'road': r[0], 'section': r[1]} for r in sections if (r[0], normalized(r[1])) not in seen],
                newFixedChargePrices=len(review['priceReviews']), newFixedClassValues=4 * len(review['priceReviews']),
                newReviewedGraphCrossings=0, newlyConfirmedJourneys=0,
                runtimeEligibility='Requires existing independent reviewed directed graph bindings; source evidence alone is ineligible',
                coverage='Incomplete: missing paid A28/A33/A19 sections and nationwide entry/exit/gantry bindings',
                inputSha256=review['inputSha256'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=DEFAULT)
    parser.add_argument('--country', default='Portugal')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/toll-evidence/Portugal/2026103001')
    parser.add_argument('--update', action='store_true', help='Merge price-only reviews into the existing fixed-price catalog')
    parser.add_argument('--check', action='store_true', help='Verify canonical prices and committed audit; never activates bindings')
    args = parser.parse_args()
    review, rows, exemptions = load(args.input, args.country)
    additions = reviewed_charges(review, rows)
    canonical = ROOT / 'android/native-app/src/main/assets/toll-charges' / (args.country + '.csv')
    if args.update:
        update_catalog(canonical, review, additions)
    check_catalog(canonical, review, additions)
    report = audit(review, rows, exemptions)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.check and (args.input / 'audit.json').read_text() != serialized:
        raise ValueError('Committed source audit is stale')
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'audit.json').write_text(serialized)
    indexes = {kind: [r['id'] for r in rows if r['scheme'] == kind and not r['conflict']] for kind in sorted(set(KINDS.values()))}
    indexes['conflict'] = [r['id'] for r in rows if r['conflict']]
    (args.output / 'evidence.json').write_text(json.dumps(dict(schemaVersion=1, country=review['country'],
        year=review['year'], currency=review['currency'], revision=review['revision'], indexes=indexes,
        records=rows, exemptions=exemptions), ensure_ascii=False, indent=2) + '\n')
    print(serialized)


if __name__ == '__main__':
    main()
