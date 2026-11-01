#!/usr/bin/env python3
"""Verify current ViaLivre published prices independently of OSM fee tags."""
import argparse
import csv
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'docs/data/toll-evidence/Portugal/2026-11-01'
CATALOG = ROOT / 'android/native-app/src/main/assets/toll-charges/Portugal.csv'


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.table = []
        elif tag == 'tr' and self.table is not None:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = ''

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(self.cell.split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def reviewed_prices(directory=EVIDENCE):
    review = json.loads((directory / 'vialivre-review.json').read_text())
    raw = (directory / 'vialivre-a28.html').read_bytes()
    if (review['country'] != 'Portugal' or review['currency'] != 'EUR' or review['year'] != 2026
            or review['reviewed'] is not True or hashlib.sha256(raw).hexdigest() != review['sourceSha256']):
        raise ValueError('Unreviewed/corrupt source identity')
    parser = Tables()
    parser.feed(raw.decode('utf-8'))
    tables = [t for t in parser.tables if any(r and r[0] == 'Angeiras' for r in t)]
    if len(tables) != 1 or tables[0][0] != ['', 'Classe 1*', 'Classe 2*', 'Classe 3*', 'Classe 4*']:
        raise ValueError('Ambiguous vehicle class table')
    prices = []
    for row in tables[0][1:]:
        if len(row) != 5 or row[0] not in review['chargeIds']:
            raise ValueError('Unreviewed/missing collection facility')
        values = []
        for text in row[1:]:
            if not re.fullmatch(r'\d+,\d{2}€', text):
                raise ValueError('Invalid published price')
            values.append(text[:-1].replace(',', '.'))
        prices.append([review['chargeIds'][row[0]], 'A28', row[0]] + values)
    if len(prices) != len(review['chargeIds']) or len({r[0] for r in prices}) != len(prices):
        raise ValueError('Incomplete or duplicate facilities')
    return review, prices


def check(path=CATALOG, directory=EVIDENCE):
    review, prices = reviewed_prices(directory)
    lines = path.read_text().splitlines()
    meta = dict(s[1:].strip().split('=', 1) for s in lines if s.startswith('#') and '=' in s)
    rows = list(csv.reader([s for s in lines if s and not s.startswith('#')], delimiter=';'))
    if (meta['country'] != review['country'] or meta['currency'] != review['currency']
            or meta['year'] != str(review['year']) or int(meta['version']) < review['revision']
            or meta.get('source.vialivreA28') != review['sourceUrl']
            or meta.get('vialivreSourceSha256') != review['sourceSha256']
            or rows[0] != ['charge', 'road', 'name', 'class1', 'class2', 'class3', 'class4']):
        raise ValueError('Wrong published catalog metadata')
    current = {r[0]: r for r in rows[1:]}
    if len(current) != len(rows) - 1 or any(current.get(r[0]) != r for r in prices):
        raise ValueError('Catalog does not preserve the independent published class prices')
    return dict(country=review['country'], source=review['sourceUrl'], sourceSha256=review['sourceSha256'],
        prices=prices, priceRecords=len(prices), classCells=sum(len(r) - 3 for r in prices),
        catalogSha256=hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=CATALOG)
    parser.add_argument('--evidence', type=Path, default=EVIDENCE)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = check(args.catalog, args.evidence)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))
