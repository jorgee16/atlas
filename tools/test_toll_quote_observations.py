import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('quotes',Path(__file__).with_name('validate-toll-quote-observations.py'))
quotes=importlib.util.module_from_spec(spec)
spec.loader.exec_module(quotes)


class QuoteObservationsTest(unittest.TestCase):
    def sample(self,**overrides):
        # Artificial validator inputs, never a purported simulator result.
        row=dict.fromkeys(quotes.FIELDS,'')
        row.update(quote_id='fixture-1',country='Portugal',currency='EUR',fraction_digits='2',
            vehicle_class='1',tariff_year='2026',observed_at='2000-01-01',source='Test fixture',
            source_url='https://example.test/quote',origin='Test origin',origin_lat='38.7',origin_lon='-9.4',
            destination='Test destination',destination_lat='38.8',destination_lon='-9.1',via='Test road',
            toll_amount='1,60',price_status='quoted',evidence='fixture.png')
        row.update(overrides)
        return row

    def validate(self,*rows):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'quotes.csv'
            with path.open('w',encoding='utf-8',newline='') as out:
                writer=csv.DictWriter(out,fieldnames=quotes.FIELDS,delimiter=';')
                writer.writeheader();writer.writerows(rows)
            return quotes.validate(path)

    def test_quoted_amount_is_not_a_runtime_authorization(self):
        result=self.validate(self.sample())
        self.assertFalse(result['eligible_for_runtime_pricing'])
        row=result['observations'][0]
        self.assertEqual(160,row['toll_minor_units'])
        self.assertEqual('unreviewed',row['matching_status'])
        self.assertFalse(row['eligible_for_runtime_pricing'])

    def test_unknown_amount_is_never_zero(self):
        row=self.validate(self.sample(price_status='unavailable',toll_amount=''))['observations'][0]
        self.assertIsNone(row['toll_minor_units'])
        with self.assertRaises(ValueError):self.validate(self.sample(price_status='unavailable',toll_amount='0'))

    def test_explicit_zero_quote_remains_unreviewed(self):
        row=self.validate(self.sample(toll_amount='0'))['observations'][0]
        self.assertEqual(0,row['toll_minor_units'])
        self.assertFalse(row['eligible_for_runtime_pricing'])

    def test_classes_and_currency_precision_are_preserved(self):
        rows=self.validate(self.sample(),self.sample(quote_id='fixture-4',vehicle_class='4',toll_amount='3.10'),
            self.sample(quote_id='fixture-jp',country='Japan',currency='JPY',fraction_digits='0',toll_amount='350'))['observations']
        self.assertEqual([160,310,350],[r['toll_minor_units'] for r in rows])
        with self.assertRaises(ValueError):self.validate(self.sample(toll_amount='1.605'))

    def test_incomplete_or_misleading_records_are_rejected(self):
        for override in [dict(origin_lat='NaN'),dict(destination_lon='181'),dict(evidence=''),
            dict(price_status='exact'),dict(source_url='http://example.test'),dict(vehicle_class=''),
            dict(toll_amount='1.60 + fuel')]:
            with self.subTest(override=override),self.assertRaises((ValueError,ArithmeticError)):
                self.validate(self.sample(**override))

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaises(ValueError):self.validate(self.sample(),self.sample())


if __name__=='__main__':unittest.main()
