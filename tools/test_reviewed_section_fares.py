import copy
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('section_fares', ROOT / 'tools/compose-reviewed-section-fares.py')
provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provider)


class ReviewedSectionFaresTests(unittest.TestCase):
    def setUp(self):
        self.review = json.loads((ROOT / 'tools/toll-binding-config/portugal-a9-section-fares.json').read_text())
        self.source = gzip.decompress((ROOT / self.review['snapshot']).read_bytes())
        self.base = (ROOT / 'android/native-app/src/main/assets/toll-fares/Portugal.csv').read_text()

    def test_official_cells_directed_crosschecks_and_idempotent_composition(self):
        text, audit = provider.compile_catalog(self.base, self.review, self.source)
        again, second = provider.compile_catalog(text, self.review, self.source)
        self.assertEqual(text, again)
        self.assertEqual(audit, second)
        self.assertEqual(4166, audit['publishedFarePairs'])
        self.assertEqual(54, audit['reviewedSectionPairs'])
        self.assertEqual(180, audit['corroboratingClassCells'])
        self.assertIn('pt-a9-linear;queluz;loures;1.80;3.10;4.00;4.45\n', text)
        self.assertIn('pt-a9-linear;a16;loures;1.50;2.55;3.30;3.65\n', text)
        self.assertNotIn('pt-a9-linear;queluz;queluz;', text)
        self.assertNotIn('pt-a9-linear;estadio;queluz;', text)

    def test_invalid_source_class_country_and_path_cannot_create_a_fare(self):
        for failure in ('hash', 'price', 'class', 'year', 'country', 'path', 'direction', 'return', 'duplicate', 'corroboration', 'settlement-alias'):
            r = copy.deepcopy(self.review)
            if failure == 'hash': r['sourceSha256'] = '0' * 64
            elif failure == 'price': r['sections'][0]['classes'][0] = '0.36'
            elif failure == 'class': r['classes'] = [1, 2, 3]
            elif failure == 'year': r['year'] = 2025
            elif failure == 'country': r['country'] = 'Elsewhere'
            elif failure == 'path': r['journeys'][0]['sections'].pop()
            elif failure == 'direction': r['journeys'][0]['direction'] = 'sideways'
            elif failure == 'return': r['journeys'][0]['exit'] = r['journeys'][0]['entry']
            elif failure == 'duplicate': r['journeys'].append(r['journeys'][0])
            elif failure == 'settlement-alias': r['crosschecks'][0]['alsoPublished'] = [['0911', '0911']]
            else: r['crosschecks'][0]['classes'][0] = '99'
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                provider.compile_catalog(self.base, r, self.source)

    def test_changing_the_original_published_catalog_requires_a_new_review(self):
        broken = self.base.replace('brisa-published;0112;0112;', 'other;0112;0112;', 1)
        self.assertNotEqual(self.base, broken)
        with self.assertRaises(ValueError): provider.compile_catalog(broken, self.review, self.source)

    def test_common_provider_supports_another_country_currency_and_classes(self):
        header = ['# country=Testland', '# currency=JPY', '# year=2026', '# version=1',
                  '# fractionDigits=0', '# scheme=entry-exit', '# source=https://example.test/matrix',
                  'network;entry;exit;class1;class9']
        base = '\n'.join(header + ['published;a;b;125;271']) + '\n'
        source = b'<table><tr><th>2026</th></tr><tr><td>Section A</td><td>2</td><td>125</td><td>271</td></tr></table>'
        review = dict(schemaVersion=1, reviewed=True, country='Testland', currency='JPY', year=2026,
                      revision=2, network='local-paths', classes=[1, 9], source='https://example.test/sections',
                      sourceSha256=hashlib.sha256(source).hexdigest(), tableIdentity='Section A',
                      sections=[dict(id=1, name='Section A', km='2', classes=['125', '271'])],
                      stations=dict(first=0, second=1), journeys=[dict(entry='first', exit='second', sections=[1], direction='increasing')],
                      crosschecks=[dict(entry='first', exit='second', publishedEntry='a', publishedExit='b', classes=['125', '271'])],
                      baseHeader=header, baseCatalogSha256=hashlib.sha256(base.encode()).hexdigest(),
                      baseAudit=dict(network='published'))
        text, _ = provider.compile_catalog(base, review, source)
        self.assertIn('local-paths;first;second;125;271\n', text)
        self.assertNotIn('local-paths;second;first;', text)


if __name__ == '__main__': unittest.main()
