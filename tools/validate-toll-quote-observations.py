#!/usr/bin/env python3
"""Validate simulator observations for comparison, never as active route prices."""
import argparse
import csv
import datetime
import decimal
import json
import re
from pathlib import Path
from urllib.parse import urlparse

FIELDS = ('quote_id country currency fraction_digits vehicle_class tariff_year observed_at source source_url '
          'origin origin_lat origin_lon destination destination_lat destination_lon via entry exit plazas '
          'toll_amount price_status evidence notes').split()


def validate(path):
    observations = []
    seen = set()
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream, delimiter=';')
        if reader.fieldnames != FIELDS:
            raise ValueError('Use the exact toll-quote-observations-template.csv header')
        for line, raw in enumerate(reader, 2):
            if None in raw or any(value is None for value in raw.values()):
                raise ValueError(f'Line {line}: invalid CSV field count')
            row = {key: value.strip() for key, value in raw.items()}
            for key in FIELDS:
                if key not in ('entry', 'exit', 'plazas', 'toll_amount', 'notes') and not row[key]:
                    raise ValueError(f'Line {line}: missing {key}')
            if row['quote_id'] in seen:
                raise ValueError(f'Line {line}: duplicate quote_id')
            seen.add(row['quote_id'])
            if not re.fullmatch(r'[A-Z]{3}', row['currency']):
                raise ValueError(f'Line {line}: invalid currency')
            for key, lower, upper in [('fraction_digits', 0, 3), ('vehicle_class', 1, 99), ('tariff_year', 1990, 2100)]:
                if not row[key].isdigit() or not lower <= int(row[key]) <= upper:
                    raise ValueError(f'Line {line}: invalid {key}')
                row[key] = int(row[key])
            date = datetime.date.fromisoformat(row['observed_at'])
            if date > datetime.date.today():
                raise ValueError(f'Line {line}: observation date is in the future')
            url = urlparse(row['source_url'])
            if url.scheme != 'https' or not url.hostname:
                raise ValueError(f'Line {line}: public HTTPS source URL required')
            for key, limit in [('origin_lat', 90), ('origin_lon', 180), ('destination_lat', 90), ('destination_lon', 180)]:
                number = decimal.Decimal(row[key].replace(',', '.'))
                if not number.is_finite() or abs(number) > limit:
                    raise ValueError(f'Line {line}: invalid {key}')
                row[key] = str(number)
            status = row['price_status']
            if status == 'unavailable':
                if row['toll_amount']:
                    raise ValueError(f'Line {line}: unavailable price must be blank, never zero')
                row['toll_minor_units'] = None
            elif status == 'quoted':
                amount = row['toll_amount'].replace(',', '.')
                if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', amount):
                    raise ValueError(f'Line {line}: toll_amount must contain only the toll price')
                units = decimal.Decimal(amount) * 10 ** row['fraction_digits']
                if units != units.to_integral_value():
                    raise ValueError(f'Line {line}: amount exceeds currency precision')
                row['toll_minor_units'] = int(units)
                row['toll_amount'] = str(decimal.Decimal(amount))
            else:
                raise ValueError(f'Line {line}: use quoted or unavailable; observations cannot be exact')
            row['matching_status'] = 'unreviewed'
            row['eligible_for_runtime_pricing'] = False
            observations.append(row)
    if not observations:
        raise ValueError('No observations supplied')
    return {'schema': 1, 'purpose': 'toll-quote-validation-observations',
            'eligible_for_runtime_pricing': False, 'observations': observations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    data = validate(args.csv)
    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Validated {len(data['observations'])} observations; none activated as route prices")


if __name__ == '__main__':
    main()
