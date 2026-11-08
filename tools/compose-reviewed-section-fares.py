#!/usr/bin/env python3
"""Compose explicitly reviewed section paths with a published fare catalog.

This is a data compiler, not a routing fallback. A road ref, a missing matrix
cell, or symmetry never selects a journey. Runtime confirmation still requires
the separate directed, graph-bound access and network-interval proof.
"""
import argparse
import csv
from decimal import Decimal
import gzip
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table': self.table = []
        elif tag == 'tr' and self.table is not None: self.row = []
        elif tag in ('td', 'th') and self.row is not None: self.cell = []

    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(' '.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compile_catalog(text, review, snapshot):
    if (review['schemaVersion'] != 1 or review['reviewed'] is not True
            or not review['source'].startswith('https://')
            or sha(snapshot) != review['sourceSha256']):
        raise ValueError('Unreviewed or changed official section source')
    classes, sections = review['classes'], review['sections']
    if (not classes or len(set(classes)) != len(classes)
            or [s['id'] for s in sections] != list(range(1, len(sections) + 1))):
        raise ValueError('Ambiguous section or class identities')
    document = Tables()
    document.feed(snapshot.decode('utf-8'))
    tables = [t for t in document.tables if any(review['tableIdentity'] in c for r in t for c in r)]
    if len(tables) != 1 or not any(str(review['year']) in c for r in tables[0] for c in r):
        raise ValueError('Missing or ambiguous official tariff table/year')
    for s in sections:
        prices = [Decimal(v) for v in s['classes']]
        if len(prices) != len(classes) or any(not p.is_finite() or p < 0 for p in prices):
            raise ValueError('Missing or invalid official class price')
        # Validate named section, length, and every class cell against the
        # actual source row; increased precision cannot manufacture a fare.
        matches = [r for r in tables[0] if s['name'] in r]
        if len(matches) != 1:
            raise ValueError('Missing or duplicate named source section')
        row = matches[0]
        index = row.index(s['name'])
        if (Decimal(row[index + 1].replace(',', '.')) != Decimal(s['km'])
                or [Decimal(v.replace(',', '.')) for v in row[index + 2:]] != prices):
            raise ValueError('Reviewed section differs from official source cells')
    network = review['network']
    rows = list(csv.DictReader((l for l in text.splitlines() if l and not l.startswith('#')), delimiter=';'))
    base_rows = [r for r in rows if r['network'] != network]
    header = review['baseHeader']
    columns = header[-1].split(';')
    base = '\n'.join(header + [';'.join(r[c] for c in columns) for r in base_rows]) + '\n'
    if sha(base.encode()) != review['baseCatalogSha256']:
        raise ValueError('Published base catalog changed; review the composition again')
    identity = dict(l[1:].strip().split('=', 1) for l in header if l.startswith('#') and '=' in l)
    if any(identity[k] != str(review[k]) for k in ('country', 'currency', 'year')):
        raise ValueError('Section/base country, currency or year mismatch')
    if columns[3:] != ['class' + str(c) for c in classes] or review['revision'] <= int(identity['version']):
        raise ValueError('Class mismatch or non-increasing catalog revision')
    digits = int(identity['fractionDigits'])
    unit = Decimal(1).scaleb(-digits)
    if any(Decimal(v) != Decimal(v).quantize(unit) for s in sections for v in s['classes']):
        raise ValueError('Source price exceeds currency precision')
    station = review['stations']
    if any(not isinstance(i, int) or i < 0 or i > len(sections) for i in station.values()):
        raise ValueError('Unknown station position')
    labels = [review.get('networkName', '')] + list(review.get('stationNames', {}).values())
    if (any(not isinstance(v, str) or len(v.encode()) > 256 or '\n' in v or '\r' in v for v in labels)
            or set(review.get('stationNames', {})) - set(station)):
        raise ValueError('Invalid network/station display labels')
    computed = {}
    for journey in review['journeys']:
        a, b = journey['entry'], journey['exit']
        if a not in station or b not in station or a == b or (a, b) in computed:
            raise ValueError('Missing, self-return or duplicate reviewed journey')
        lo, hi = sorted((station[a], station[b]))
        ids = list(range(lo + 1, hi + 1))
        direction = 'increasing' if station[a] < station[b] else 'decreasing'
        if direction == 'decreasing': ids.reverse()
        if not ids or journey['sections'] != ids or journey['direction'] != direction:
            raise ValueError('Unreviewed or discontinuous directed section path')
        computed[a, b] = [sum((Decimal(s['classes'][k]) for s in sections[lo:hi]), Decimal(0))
                          for k in range(len(classes))]
    published = {(r['entry'], r['exit']): r for r in base_rows if r['network'] == review['baseAudit']['network']}
    checks, additional_checks = set(), set()
    for check in review['crosschecks']:
        pair = check['entry'], check['exit']
        source_pair = check['publishedEntry'], check['publishedExit']
        if pair in checks or pair not in computed or source_pair not in published:
            raise ValueError('Invalid independent directed fare crosscheck')
        expected = [Decimal(published[source_pair]['class' + str(c)]) for c in classes]
        if expected != computed[pair] or expected != [Decimal(v) for v in check['classes']]:
            raise ValueError('Section path disagrees with independently published directed fare')
        for alias in check.get('alsoPublished', []):
            alternate = tuple(alias)
            if alternate not in published or alternate in additional_checks:
                raise ValueError('Unknown or duplicate additional published station pair')
            if [Decimal(published[alternate]['class' + str(c)]) for c in classes] != computed[pair]:
                raise ValueError('Different physical settlement stations have different tariffs')
            additional_checks.add(alternate)
        checks.add(pair)
    if not checks:
        raise ValueError('No independent directed fare crosschecks')
    extra = [';'.join([network, a, b] + [f'{v:.{digits}f}' for v in values])
             for (a, b), values in sorted(computed.items())]
    merged_header = [l.replace('# version=' + identity['version'], '# version=' + str(review['revision']))
                     for l in header[:-1]]
    merged_header += ['# source.sections=' + review['source'], '# sourceSectionsSha256=' + review['sourceSha256']]
    merged_header.append('# networkSource.' + network + '=' + review['source'])
    if review.get('networkName'):
        merged_header.append('# networkName.' + network + '=' + review['networkName'])
    merged_header += ['# stationName.' + network + '.' + k + '=' + v for k, v in sorted(review.get('stationNames', {}).items())]
    merged_header.append(header[-1])
    payload = '\n'.join(merged_header + [';'.join(r[c] for c in columns) for r in base_rows] + extra) + '\n'
    report = dict(review['baseAudit'])
    report.update(revision=review['revision'], catalogSha256=sha(payload.encode()),
                  farePairs=len(base_rows) + len(extra), publishedFarePairs=len(base_rows),
                  reviewedSectionPairs=len(extra), sectionNetwork=network,
                  sectionSourceSha256=review['sourceSha256'], sectionReviewSha256=sha(json.dumps(review, sort_keys=True).encode()),
                  corroboratingDirectedJourneys=len(checks), additionalPublishedPairs=len(additional_checks),
                  corroboratingClassCells=(len(checks) + len(additional_checks)) * len(classes))
    return payload, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=ROOT / 'android/native-app/src/main/assets/toll-fares/Portugal.csv')
    parser.add_argument('--review', type=Path, default=ROOT / 'tools/toll-binding-config/portugal-a9-section-fares.json')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--audit', type=Path, default=ROOT / 'docs/data/portugal-entry-exit-2026-audit.json')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    review = json.loads(args.review.read_text())
    snapshot = gzip.decompress((ROOT / review['snapshot']).read_bytes())
    payload, report = compile_catalog(args.base.read_text(), review, snapshot)
    audit = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    target = args.out or args.base
    if args.check:
        if target.read_text() != payload or args.audit.read_text() != audit:
            raise SystemExit('Reviewed section fare catalog/audit differs')
    else:
        target.write_text(payload)
        args.audit.write_text(audit)
    print(json.dumps({k: report[k] for k in ('farePairs', 'reviewedSectionPairs', 'corroboratingClassCells')}))
