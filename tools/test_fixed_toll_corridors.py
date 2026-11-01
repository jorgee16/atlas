import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


fixed = module('build-fixed-toll-corridors')
prices = module('import-vialivre-tolls')


class FixedCorridorTests(unittest.TestCase):
    def test_gate_removed_by_simplification_is_recovered_on_its_source_subpath(self):
        source = [(40., -8.), (40., -7.9995), (40., -7.999)]
        graph = [source[0], source[-1]]
        witness = fixed.clipped_way_witness(graph, source)
        offsets = fixed.crossing_offsets(graph, source, [1, 2, 3], {2: 'operator:gate'}, witness, 100)
        self.assertEqual(2, offsets[0]['osmNodeId'])
        self.assertAlmostEqual(50, offsets[0]['offsetMeters'])
        # A synthetic clipped edge need not begin at an original OSM vertex.
        graph = [(40., -7.99975), (40., -7.99925)]
        witness = fixed.clipped_way_witness(graph, source)
        self.assertAlmostEqual(25, fixed.crossing_offsets(graph, source, [1, 2, 3],
            {2: 'operator:gate'}, witness, 50)[0]['offsetMeters'])

    def test_gate_at_split_is_charged_only_on_outgoing_interval(self):
        source = [(40., -8.), (40., -7.9995), (40., -7.999)]
        for graph, expected in ((source[:2], 0), (source[1:], 1)):
            witness = fixed.clipped_way_witness(graph, source)
            events = fixed.crossing_offsets(graph, source, [1, 2, 3], {2: 'operator:gate'}, witness, 50)
            self.assertEqual(expected, len(events))
            if events:
                self.assertEqual(0, events[0]['offsetMeters'])
        graph = [(40., -7.9994), source[-1]]
        self.assertEqual([], fixed.crossing_offsets(graph, source, [1, 2, 3], {2: 'operator:gate'},
            fixed.clipped_way_witness(graph, source), 40))

    def test_unknown_collection_and_changed_direction_block_certification(self):
        cfg = ROOT / 'tools/toll-binding-config'
        review = json.loads((cfg / 'portugal-a28.json').read_text())
        source = json.loads((cfg / 'portugal-a28.source.json').read_text())
        shapes, gates, _ = fixed.source_shapes(review, source)
        self.assertEqual(4, len(gates))
        self.assertEqual(538, len(shapes))
        for failure in ('gate', 'direction', 'country', 'unreviewed', 'unknown-way'):
            r, s = copy.deepcopy(review), copy.deepcopy(source)
            if failure == 'gate':
                del r['chargePoints'][next(iter(r['chargePoints']))]
            elif failure == 'direction':
                s['ways'][0]['tags']['oneway'] = 'no'
            elif failure == 'country':
                s['country'] = 'Spain'
            elif failure == 'unreviewed':
                r['reviewed'] = False
            else:
                s['ways'].pop()
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                fixed.source_shapes(r, s)

    def test_published_independent_classes_and_corrupt_source(self):
        review, rows = prices.reviewed_prices()
        self.assertEqual(['0.55', '1.05', '1.35', '1.50'], rows[0][3:])
        self.assertEqual(['0.80', '1.30', '1.75', '1.95'], rows[1][3:])
        self.assertEqual(8, prices.check()['classCells'])
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            for name in ('vialivre-review.json', 'vialivre-a28.html'):
                shutil.copyfile(prices.EVIDENCE / name, target / name)
            path = target / 'vialivre-a28.html'
            path.write_text(path.read_text().replace('0,55€', '0,90€'))
            with self.assertRaisesRegex(ValueError, 'corrupt'):
                prices.reviewed_prices(target)


if __name__ == '__main__':
    unittest.main()
