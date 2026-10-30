import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('import-toll-evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review, cls.rows, cls.exemptions = evidence.load()

    def test_original_bundle_integrity_and_real_coverage(self):
        self.assertEqual(967, len(self.rows))
        self.assertEqual(36, sum(r['conflict'] for r in self.rows))
        self.assertEqual(67, sum(r['vehicleRestriction'] is not None for r in self.rows))
        self.assertEqual(8, len(self.exemptions))
        self.assertFalse(any(r['eligibleForRuntimePricing'] for r in self.rows + self.exemptions))
        report = evidence.audit(self.review, self.rows, self.exemptions)
        self.assertEqual(600, report['imtClassValuesConsistent'])
        self.assertEqual(24, report['brisaDirectedClassValuesConsistent'])
        self.assertEqual([{'road': 'A1', 'section': 'Ligação PLLN'}], report['retainedSectionsAbsentFromInput'])
        self.assertEqual(0, report['newlyConfirmedJourneys'])

    def test_corrupt_payload_and_country_switch_fail_before_price_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('review.json', 'manifest.json', 'tarifas_portagens_2026.csv', 'excecoes_zero_2026.csv'):
                (root / name).write_bytes((evidence.DEFAULT / name).read_bytes())
            with self.assertRaises(ValueError):
                evidence.load(root, 'Spain')
            with (root / 'tarifas_portagens_2026.csv').open('ab') as stream:
                stream.write(b'\n')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                evidence.load(root)

    def test_minor_units_reject_rounding_nan_negative_and_unknown_zero(self):
        self.assertEqual(765, evidence.cents('7.65'))
        self.assertEqual(0, evidence.cents('0.00'))
        for value in ('', 'NaN', 'inf', '-1.00', '1.001', '1,60', '1e3'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                evidence.cents(value)

    def test_source_od_keys_and_class_prices_are_preserved_without_synthesis(self):
        rows = [r for r in self.rows if r['scheme'] == 'entry-exit']
        values = {int(r['classe']): r['amountMinor'] for r in rows
                  if r['entrada'] == '0117: Coimbra Norte' and r['saida'] == '0122: Fátima'}
        self.assertEqual({1: 765, 2: 1335, 3: 1725, 4: 1905}, values)
        self.assertFalse(any(r['entrada'].startswith('0122:') for r in rows))
        self.assertFalse(any(r['geometryReviewed'] or r['directionReviewed'] for r in rows))
        # A source OD/section cannot be promoted to a fixed crossing price.
        config = copy.deepcopy(self.review)
        config['priceReviews'][0]['sourceRecordId'] = rows[0]['id']
        with self.assertRaises(ValueError):
            evidence.reviewed_charges(config, self.rows)

    def test_independent_a16_and_electronic_prices_without_class5_leakage(self):
        additions = evidence.reviewed_charges(self.review, self.rows)
        self.assertEqual(22, len(additions))
        a16 = {r[0]: r[3:] for r in additions if r[1] == 'A16'}
        self.assertEqual({
            'ascendi:grande-lisboa:01': ['0.65', '1.15', '1.50', '1.65'],
            'ascendi:grande-lisboa:02': ['0.65', '1.10', '1.45', '1.60'],
            'ascendi:grande-lisboa:03': ['1.20', '2.10', '2.70', '2.95'],
        }, a16)
        self.assertTrue(all(len(r) == 7 for r in additions))
        self.assertEqual(12, sum(r[0].startswith('ascendi:grande-porto:') for r in additions))
        self.assertTrue(all(not r['directionReviewed'] for r in self.rows if r['scheme'] in ('gantry', 'plaza', 'bridge')))

    def test_conflict_missing_class_and_ambiguous_source_block_promotion(self):
        for failure in ('conflict', 'missing', 'duplicate'):
            rows = copy.deepcopy(self.rows)
            target = next(r for r in rows if r['via'] == 'A16' and r['classe'] == '3')
            if failure == 'conflict':
                target['conflict'] = True
            elif failure == 'missing':
                rows.remove(target)
            else:
                rows.append(dict(target, id='a' * 16))
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                evidence.reviewed_charges(self.review, rows)

    def test_duplicate_charge_and_restricted_class_promotion_rejected(self):
        for failure in ('duplicate', 'class5', 'geometry'):
            review = copy.deepcopy(self.review)
            if failure == 'duplicate':
                review['priceReviews'].append(copy.deepcopy(review['priceReviews'][0]))
            elif failure == 'class5':
                review['priceReviews'][0]['reviewedClasses'].append(5)
            else:
                review['priceReviews'][0]['geometryReviewed'] = True
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                evidence.reviewed_charges(review, self.rows)

    def test_merge_preserves_existing_prices_and_rejects_temporal_downgrade(self):
        additions = evidence.reviewed_charges(self.review, self.rows)
        canonical = evidence.ROOT / 'android/native-app/src/main/assets/toll-charges/Portugal.csv'
        _, _, _, original = evidence.catalog_parts(canonical)
        brisa = [r for r in original if r[0].startswith('brisa:')]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'Portugal.csv'
            path.write_bytes(canonical.read_bytes())
            evidence.update_catalog(path, self.review, additions)
            first = path.read_bytes()
            evidence.update_catalog(path, self.review, additions)
            self.assertEqual(first, path.read_bytes())
            _, _, _, merged = evidence.catalog_parts(path)
            self.assertEqual(brisa, [r for r in merged if r[0].startswith('brisa:')])
            self.assertEqual(32, len(merged))
            text = path.read_text().replace(str(self.review['revision']), str(self.review['revision'] + 1))
            path.write_text(text)
            with self.assertRaisesRegex(ValueError, 'newer'):
                evidence.update_catalog(path, self.review, additions)

    def test_scoped_exemptions_never_become_global_road_zero(self):
        scopes = {r['via']: r for r in self.exemptions}
        for road in ('A4', 'A13', 'A28'):
            self.assertFalse(scopes[road]['eligibleForRuntimePricing'])
        self.assertIn('APENAS', scopes['A28']['aplicacao'])
        self.assertIn('NÃO', scopes['A13']['zona_legal'])
        self.assertEqual('2026-01-01', scopes['A25']['vigencia_inicio'])
        self.assertTrue(all(not r['eligibleForRuntimePricing'] for r in self.rows if r['conflict']))


if __name__ == '__main__':
    unittest.main()
