import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from toll_free_geometry import clipped_way_witness

TOOLS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('free_corridors', TOOLS / 'build-free-toll-corridors.py')
corridors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corridors)


class GeometryTests(unittest.TestCase):
    def test_synthetic_endpoints_clip_inside_original_segment(self):
        original = [(40., -8.), (40., -7.99)]
        graph = [(40., -7.999), (40., -7.998)]
        before = copy.deepcopy((graph, original))
        result = clipped_way_witness(graph, original, tolerance=2.)
        self.assertIsNotNone(result)
        self.assertGreater(result['beginMeters'], 0)
        self.assertGreater(result['endMeters'], result['beginMeters'])
        self.assertEqual(before, (graph, original))

    def test_reverse_requires_explicit_source_direction(self):
        original = [(40., -8.), (40., -7.99)]
        graph = [(40., -7.998), (40., -7.999)]
        self.assertIsNone(clipped_way_witness(graph, original))
        self.assertIsNotNone(clipped_way_witness(graph, original, reverse=True))

    def test_curve_shortcut_and_hidden_source_spike_are_rejected(self):
        source = [(40., -8.), (40.0002, -8.), (40.0002, -7.9998)]
        graph = [source[0], source[-1]]
        self.assertIsNone(clipped_way_witness(graph, source, tolerance=2.))
        spike = [(40., -8.), (40., -7.99995), (40.00003, -7.99995),
                 (40., -7.99994), (40., -7.9999)]
        self.assertIsNone(clipped_way_witness([spike[0], spike[-1]], spike, tolerance=2.))

    def test_existing_error_bound_is_not_relaxed_for_a_nearby_road(self):
        source = [(40., -8.), (40., -7.999)]
        nearby = [(40.000019, -7.9999), (40.000019, -7.9998)]
        self.assertIsNone(clipped_way_witness(nearby, source, tolerance=2.))
        within = [(40.00001, -7.9999), (40.00001, -7.9998)]
        self.assertIsNotNone(clipped_way_witness(within, source, tolerance=2.))

    def test_nonfinite_empty_and_degenerate_geometry_cannot_certify(self):
        source = [(40., -8.), (40., -7.999)]
        for graph in ([], [(40., -8.)], [(40., -8.), (40., -8.)], [(float('nan'), -8.), source[-1]]):
            with self.subTest(graph=graph):
                self.assertIsNone(clipped_way_witness(graph, source))
        with self.assertRaises(ValueError):
            clipped_way_witness(source, source, tolerance=10.)

    def test_closed_roundabout_clips_across_origin_without_wrong_way(self):
        ring = [(40., -8.), (40., -7.9998), (40.0002, -7.9998), (40.0002, -8.), (40., -8.)]
        forward = [(40.0001, -8.), (40., -8.), (40., -7.9999)]
        self.assertIsNotNone(clipped_way_witness(forward, ring))
        self.assertIsNone(clipped_way_witness(list(reversed(forward)), ring))


class ReviewTests(unittest.TestCase):
    def paths(self):
        root = TOOLS / 'toll-binding-config'
        return (root / 'portugal-lisbon-free-corridors.json',
                root / 'portugal-lisbon-free-corridors.source.json',
                root / 'portugal-a5-reviewed-seed.csv')

    def test_source_approvals_and_original_charged_events_are_preserved(self):
        review, source, seed, _, shapes = corridors.inputs(*self.paths())
        self.assertEqual(99, len(shapes))
        self.assertEqual(735, len(source['chargeCandidates']))
        asset = TOOLS.parent / 'android/native-app/src/main/assets/toll-bindings/Portugal/mainland.csv'
        charged = lambda lines: [line for line in lines if line.startswith('crossing;')]
        self.assertEqual(charged(seed), charged(asset.read_text().splitlines()))
        self.assertEqual(4, len(charged(seed)))
        self.assertEqual(2.0, review['geometrySimplificationMeters'])

    def test_corrupt_unreviewed_and_foreign_sources_cannot_certify_free(self):
        review_path, source_path, seed = self.paths()
        for failure in ('hash', 'unreviewed', 'country'):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                review = json.loads(review_path.read_text())
                src = root / 'source.json'; src.write_bytes(source_path.read_bytes())
                if failure == 'hash':
                    src.write_bytes(src.read_bytes() + b'\n')
                elif failure == 'unreviewed':
                    review['reviewed'] = False
                else:
                    review['country'] = 'Otherland'
                cfg = root / 'review.json'; cfg.write_text(json.dumps(review))
                with self.subTest(failure=failure), self.assertRaises(ValueError):
                    corridors.inputs(cfg, src, seed)

    def test_a_physical_charging_point_blocks_a_free_certificate(self):
        review_path, source_path, seed = self.paths()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, review = json.loads(source_path.read_text()), json.loads(review_path.read_text())
            node = str(source['ways'][0]['nodes'][0]); lat, lon = source['coordinates'][node]
            source['chargeCandidates'].append(dict(id=999999999999, lat=lat, lon=lon))
            src = root / 'source.json'; src.write_text(json.dumps(source))
            review['sourceSha256'] = hashlib.sha256(src.read_bytes()).hexdigest()
            cfg = root / 'review.json'; cfg.write_text(json.dumps(review))
            with self.assertRaisesRegex(ValueError, 'facility'):
                corridors.inputs(cfg, src, seed)


if __name__ == '__main__':
    unittest.main()
