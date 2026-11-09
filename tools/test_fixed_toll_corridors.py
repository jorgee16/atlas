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
ticket_review = module('prepare-reviewed-a1-network')


class FixedCorridorTests(unittest.TestCase):
    def test_review_includes_electronic_gantries_and_keeps_foreign_facilities_as_barriers(self):
        nodes=[{'type':'node','id':1,'tags':{'barrier':'toll_booth'}},
               {'type':'node','id':2,'tags':{'highway':'toll_gantry'}},
               {'type':'node','id':3,'tags':{'highway':'toll_gantry','toll':'no'}},
               {'type':'node','id':4,'tags':{'highway':'bus_stop'}}]
        captured,reviewed=ticket_review.collection_nodes(nodes,[1,2])
        self.assertEqual({1,2,3},captured)
        self.assertEqual([1,2],reviewed)
        for invalid in (None,[1,1],[1,4],[99]):
            with self.subTest(approved=invalid),self.assertRaises(ValueError):
                ticket_review.collection_nodes(nodes,invalid)

    def test_station_review_keeps_both_mainline_directions_without_crossing_other_booths(self):
        edges={1:[(2,10)],2:[(3,20),(4,30),(7,40),(8,50)],
               3:[(5,21)],4:[(6,31)],7:[(9,41)],8:[(8,51)]}
        paths=ticket_review.station_paths(1,edges,{5,6,9},{1,7})
        self.assertEqual({10,20,21,30,31},{p[2] for p in paths})
        self.assertIsNone(ticket_review.station_paths(1,edges,{9},{1,7}))
        self.assertIsNone(ticket_review.station_paths(5,edges,{1},{5}))

    def test_a1_network_preserves_legal_station_identity_and_free_side_of_exit(self):
        cfg=ROOT/'tools/toll-binding-config'
        review=json.loads((cfg/'portugal-a1-coimbra-fatima.json').read_text())
        source=json.loads((cfg/'portugal-a1-coimbra-fatima.source.json').read_text())
        _,gates,_=fixed.source_shapes(review,source)
        self.assertEqual(44,len(gates))
        self.assertEqual(44,len(source['chargeCandidates']))
        ids={'0134',*[str(i).zfill(4) for i in range(112,124)]}
        self.assertEqual({f'{role}:brisa-published:{i}' for i in ids for role in ('entry','exit')},set(gates.values()))
        self.assertEqual({'endNode':255584272},review['networkRanges']['19900140'])
        self.assertEqual('exit:brisa-published:0121',gates[255584272])

    def test_ascendi_facilities_are_in_the_published_geographical_corridors(self):
        # Independent geographical regression: booth nodes in southern A17
        # and the A1 Feira access are not northern electronic-toll facilities.
        expected = {
            'a17': {
                'ascendi:costa-de-prata:01': ({1563499859,1563499866},(40.45,40.48)),
                'ascendi:costa-de-prata:02': ({1563499922,1563499923},(40.55,40.58)),
                'ascendi:costa-de-prata:03': ({1563499950,1563499968},(40.61,40.63)),
            },
            'a29': {'ascendi:costa-de-prata:07': ({1563530097,1563530098},(41.07,41.09))},
            'a42': {
                'ascendi:grande-porto:10': ({264117176,264119609},(41.23,41.25)),
                'ascendi:grande-porto:11': ({2869384457,2869384458},(41.25,41.27)),
                'ascendi:grande-porto:12': ({264119862,2869381630},(41.28,41.30)),
            },
        }
        cfg = ROOT / 'tools/toll-binding-config'
        for road, facilities in expected.items():
            review=json.loads((cfg/f'portugal-{road}-fixed.json').read_text())
            source=json.loads((cfg/f'portugal-{road}-fixed.source.json').read_text())
            candidates={p['id']:p for p in source['chargeCandidates']}
            for charge,(nodes,(south,north)) in facilities.items():
                actual={int(n) for n,c in review['chargePoints'].items() if c==charge}
                self.assertEqual(nodes,actual)
                for node in actual:
                    p=candidates[node]
                    self.assertEqual('toll_gantry',p['tags'].get('highway'))
                    self.assertLess(south,p['lat']);self.assertLess(p['lat'],north)

    def test_national_ascendi_reviews_bind_twelve_facilities_without_a41_conflicts(self):
        cfg = ROOT / 'tools/toll-binding-config'
        charges = set()
        directed_nodes = 0
        for road, expected in (('a4', 2), ('a17', 3), ('a29', 4), ('a42', 3)):
            review = json.loads((cfg / f'portugal-{road}-fixed.json').read_text())
            source = json.loads((cfg / f'portugal-{road}-fixed.source.json').read_text())
            shapes, gates, _ = fixed.source_shapes(review, source)
            self.assertTrue(shapes)
            self.assertEqual(expected * 2, len(gates))
            self.assertEqual(set(gates), {p['id'] for p in source['chargeCandidates']})
            charges.update(gates.values())
            directed_nodes += len(gates)
        self.assertEqual(12, len(charges))
        self.assertEqual(24, directed_nodes)
        self.assertFalse(any(':a41:' in charge for charge in charges))

    def test_barrier_free_access_is_a_directed_paid_boundary_not_a_fake_booth(self):
        cfg = ROOT / 'tools/toll-binding-config'
        review = json.loads((cfg / 'portugal-a9-linear.json').read_text())
        source = json.loads((cfg / 'portugal-a9-linear.source.json').read_text())
        _, gates, _ = fixed.source_shapes(review, source)
        physical = {p['id'] for p in source['chargeCandidates']}
        for node, access in review['networkAccessPoints'].items():
            self.assertNotIn(int(node), physical)
            self.assertEqual(access['event'], gates[int(node)])
            self.assertEqual('ascendi:grande-lisboa:01', access['requiresFixedCharge'])
        for failure in ('role', 'network', 'source-way', 'paid-boundary', 'fixed-charge'):
            r = copy.deepcopy(review)
            first = next(iter(r['networkAccessPoints'].values()))
            if failure == 'role': first['role'] = 'fixed'
            elif failure == 'network': r['network'] = 'another-network'
            elif failure == 'source-way': first['sourceWay'] = -1
            elif failure == 'paid-boundary': r['networkRanges'] = {}
            else: first['requiresFixedCharge'] = 'entry:n:fake'
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                fixed.source_shapes(r, source)

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
        self.assertTrue({'entry:brisa-published:0117','exit:brisa-published:0122'} <= set(gates.values()))
        self.assertEqual(44,len(gates))
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
