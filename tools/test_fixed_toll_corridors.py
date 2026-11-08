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

    def test_real_oeiras_split_owns_the_gate_only_on_its_outgoing_edge(self):
        import struct
        cfg=ROOT/'tools/toll-binding-config'
        source=json.loads((cfg/'portugal-a5-reviewed-accesses.source.json').read_text())
        nodes={int(k):tuple(v) for k,v in source['coordinates'].items()}
        ways={w['id']:w for w in source['ways']}
        gate=3751374533
        quantized=lambda p:tuple(struct.unpack('<ff',struct.pack('<ff',*p)))
        events=[]
        for wid,length in ((418240487,58.2),(320186742,79.7)):
            ids=ways[wid]['nodes'];original=[nodes[n] for n in ids]
            graph=[quantized(p) for p in original]
            witness=fixed.clipped_way_witness(graph,original,tolerance=2.5)
            self.assertIsNotNone(witness)
            current=fixed.crossing_offsets(graph,original,ids,{gate:'brisa:0504'},witness,length)
            events.extend(current)
            self.assertEqual(0 if wid==418240487 else 1,len(current))
        self.assertEqual(1,len(events))
        self.assertEqual(0.,events[0]['offsetMeters'])

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

    def test_paid_interval_is_bounded_by_the_actual_gate(self):
        source = [(40., -8.), (40., -7.9995), (40., -7.999)]
        graph = [source[0], source[-1]]
        witness = fixed.clipped_way_witness(graph, source)
        first,last=fixed.network_offsets(graph,source,[1,2,3],witness,100,{'beginNode':2})
        self.assertAlmostEqual(50.,first,places=8);self.assertEqual(100.,last)
        first,last=fixed.network_offsets(graph,source,[1,2,3],witness,100,{'endNode':2})
        self.assertEqual(0.,first);self.assertAlmostEqual(50.,last,places=8)
        after = [source[1],source[2]]
        self.assertIsNone(fixed.network_offsets(after,source,[1,2,3],
            fixed.clipped_way_witness(after,source),50,{'endNode':2}))

    def test_only_reviewed_node_connected_directed_chains_are_allowed(self):
        cfg=ROOT / 'tools/toll-binding-config'
        review=json.loads((cfg/'portugal-a1-coimbra-fatima.json').read_text())
        source=json.loads((cfg/'portugal-a1-coimbra-fatima.source.json').read_text())
        shapes,gates,_=fixed.source_shapes(review,source)
        self.assertIn('chain:392905851+392905864',shapes)
        self.assertEqual({'entry:brisa-published:0117','exit:brisa-published:0122'},set(gates.values()))
        for ids in ([392905864,392905851],[392905851,392905851],[392905851,999]):
            bad=copy.deepcopy(review);bad['directedChains']=[dict(wayIds=ids)]
            with self.subTest(ids=ids),self.assertRaises(ValueError):
                fixed.source_shapes(bad,source)

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
