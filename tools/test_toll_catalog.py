import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import struct
import unittest

ROOT=Path(__file__).resolve().parent

def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

pack=module('toll-catalog');publisher=module('publish-toll-catalogs');graph_audit=module('audit-toll-graph')

class Missing(Exception):
    response={'Error':{'Code':'NoSuchKey'}}

class Storage:
    def __init__(self): self.objects={};self.writes=[]
    def get_object(self,Bucket,Key):
        if Key not in self.objects: raise Missing()
        data=self.objects[Key]
        return {'Body':io.BytesIO(data),'ETag':hashlib.sha256(data).hexdigest()}
    def put_object(self,**kwargs):
        key=kwargs['Key'];old=self.objects.get(key)
        if kwargs.get('IfNoneMatch')=='*' and old is not None: raise RuntimeError('Collision')
        if 'IfMatch' in kwargs and (old is None or hashlib.sha256(old).hexdigest()!=kwargs['IfMatch']): raise RuntimeError('Concurrent publication')
        self.objects[key]=kwargs['Body'];self.writes.append(key)

class CatalogTests(unittest.TestCase):
    def fixture(self,version=1):
        return f'# country=Testland\n# currency=JPY\n# year=2026\n# version={version}\n# fractionDigits=0\n# source=https://example.test/fixture\nroad;section;km;class1;class5\nT1;one;10;100;230\n'
    def test_production_manifest_binds_canonical_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            source=ROOT.parent/'android/native-app/src/main/assets/tolls/Portugal.csv'
            result=pack.package(source,Path(temp))
            self.assertEqual(151,result['sectionCount']);self.assertEqual([1,2,3,4],result['vehicleClasses'])
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),result['sha256'])
    def test_publish_is_immutable_monotonic_and_manifest_last(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'Testland.csv';source.write_text(self.fixture());pack.package(source,root)
            storage=Storage();publisher.publish(storage,'atlas-regions',root)
            self.assertEqual('toll-tariffs/Testland/manifest.json',storage.writes[-1])
            self.assertEqual(3,len(storage.writes))
            publisher.publish(storage,'atlas-regions',root);self.assertEqual(3,len(storage.writes))
            source.write_text(self.fixture(2));pack.package(source,root);publisher.publish(storage,'atlas-regions',root)
            self.assertEqual(2,json.loads(storage.objects['toll-tariffs/Testland/manifest.json'])['revision'])
            old=root/'toll-tariffs/Testland/1/manifest.json'
            (root/'toll-tariffs/Testland/manifest.json').write_bytes(old.read_bytes())
            with self.assertRaises(ValueError): publisher.publish(storage,'atlas-regions',root)
    def test_corrupt_or_conflicting_payload_cannot_be_published(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'Testland.csv';source.write_text(self.fixture());pack.package(source,root)
            target=root/'toll-tariffs/Testland/1/table.csv';target.write_text('broken')
            storage=Storage()
            with self.assertRaises(ValueError): publisher.publish(storage,'atlas-regions',root)
            self.assertFalse(storage.writes)
    def test_invalid_class_duplicate_and_country_are_rejected(self):
        for text in [self.fixture().replace('class5','class1'),self.fixture()+'T1;one;2;1;2\n',self.fixture().replace('Testland','Elsewhere')]:
            with tempfile.TemporaryDirectory() as temp:
                source=Path(temp)/'Testland.csv';source.write_text(text)
                with self.assertRaises(ValueError): pack.package(source,Path(temp))

    def test_graph_audit_counts_only_directed_driving_toll_edges(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);strings=b'\0A5\0A2\0N1\0'
            (root/'strings.bin').write_bytes(b'RSTR'+struct.pack('<II',6,len(strings))+strings)
            roads=bytearray(b'RROD'+struct.pack('<III',6,3,36)+bytes(3*36))
            for i,(offset,flags) in enumerate([(1,4),(4,4),(7,0)]):
                struct.pack_into('<I',roads,16+i*36+4,offset);struct.pack_into('<I',roads,16+i*36+32,flags)
            (root/'roads.bin').write_bytes(roads)
            records=[(0,10000,0,0x20000000,0),(0,20000,0,0x20000000,1),(0,30000,0,0x20000000,2),(0,40000,0,0x40000000,0)]
            edges=b'REDG'+struct.pack('<IIII',6,1,len(records),20)+struct.pack('<II',0,len(records))
            edges+=b''.join(struct.pack('<IIIII',*row) for row in records)
            (root/'edges.bin').write_bytes(edges)
            result=graph_audit.scan({n:root/n for n in ['roads.bin','strings.bin','edges.bin']},{'A5':True,'A2':False})
            self.assertEqual({'A5','A2'},set(result))
            self.assertEqual(1000,result['A5']['estimatedMeters'])
            self.assertEqual(2000,result['A2']['directedMeters']);self.assertEqual(0,result['A2']['estimatedMeters'])
            free=graph_audit.scan({n:root/n for n in ['roads.bin','strings.bin','edges.bin']},{'A5':True,'A2':False},{'A2'})
            self.assertEqual(2000,free['A2']['explicitlyFreeMeters'])
            self.assertEqual(0,free['A2']['estimatedMeters'])
            self.assertEqual(0,free['A5']['explicitlyFreeMeters'])
            # An excluded paid reference must still block an ambiguous free alias.
            strings=b'\0A25;A2\0A2\0N1\0'
            (root/'strings.bin').write_bytes(b'RSTR'+struct.pack('<II',6,len(strings))+strings)
            struct.pack_into('<I',roads,16+36+4,8);struct.pack_into('<I',roads,16+72+4,11)
            (root/'roads.bin').write_bytes(roads)
            ambiguous=graph_audit.scan({n:root/n for n in ['roads.bin','strings.bin','edges.bin']},{'A2':False},{'A25'})
            self.assertEqual(0,ambiguous['A25;A2']['explicitlyFreeMeters'])

    def test_fixed_catalog_has_independent_namespace_and_no_distance_column(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            source=ROOT.parent/'android/native-app/src/main/assets/toll-charges/Portugal.csv'
            result=pack.package(source,root,'toll-charges')
            self.assertEqual('fixed-crossing',result['scheme']);self.assertEqual(10,result['chargeCount'])
            self.assertTrue(result['path'].startswith('/toll-charges/Portugal/'))
            storage=Storage();publisher.publish(storage,'atlas-regions',root,'toll-charges')
            self.assertEqual('toll-charges/Portugal/manifest.json',storage.writes[-1])
            self.assertTrue(all(k.startswith('toll-charges/') for k in storage.writes))
            with self.assertRaises(ValueError): pack.package(source,root,'toll-tariffs')



class DirectedSourceGeometryTests(unittest.TestCase):
    def test_packager_removed_collinear_gate_is_recovered_from_original_path(self):
        builder=module('build-toll-bindings')
        a=(38.,-9.);gate=(38.,-8.9999);b=(38.,-8.9998)
        self.assertEqual([a,gate,b],builder.source_path(a,b,{a:{gate},gate:{b}},2.))
        self.assertIsNone(builder.source_path(b,a,{a:{gate},gate:{b}},2.))

    def test_parallel_road_or_sharp_corner_cannot_certify_a_shortcut(self):
        builder=module('build-toll-bindings')
        a=(38.,-9.);off=(38.0001,-8.9999);b=(38.,-8.9998)
        self.assertIsNone(builder.source_path(a,b,{a:{off},off:{b}},2.))
        self.assertIsNone(builder.source_path(a,b,{(38.0001,-9.):{b}},2.))

    def test_ambiguous_or_backtracking_source_paths_are_rejected(self):
        builder=module('build-toll-bindings')
        a=(38.,-9.);p=(38.,-8.9999);q=(38.000001,-8.9999);b=(38.,-8.9998)
        self.assertIsNone(builder.source_path(a,b,{a:{p,q},p:{b},q:{b}},2.))
        self.assertIsNone(builder.source_path(a,b,{a:{p},p:{(38.,-8.99995)},(38.,-8.99995):{b}},2.))

class ActivatedBindingIntegrityTests(unittest.TestCase):
    def test_apk_proof_matches_reviewed_report_and_actual_region_identity(self):
        asset=ROOT.parent/'android/native-app/src/main/assets/toll-bindings/Portugal/mainland.csv'
        report=json.loads((ROOT.parent/'docs/data/a5-mainline-binding-audit-20261026.json').read_text())
        self.assertEqual(report['sha256'],hashlib.sha256(asset.read_bytes()).hexdigest())
        text=asset.read_text()
        self.assertEqual(report['certifiedDirectedEdges'],sum(x.startswith('coverage;') for x in text.splitlines()))
        self.assertEqual(len(report['bindings']),sum(x.startswith('crossing;') for x in text.splitlines()))
        regions=json.loads((ROOT.parent/'android/native-app/src/main/assets/regions.json').read_text())
        region=next(r for r in regions['regions'] if r['id']=='portugal')
        for name,digest in report['graphDigests'].items():
            entry=next(e for e in region['package']['files'] if e['url'].endswith('/mainland/'+name))
            self.assertEqual(entry['sha256'],digest)
            self.assertIn('# graph.'+name+'='+digest,text)
        self.assertEqual({'brisa:0501'},{b['chargeId'] for b in report['bindings']})
        self.assertEqual({4},{b['graphRoadFlags'] for b in report['bindings']})

class ExplicitFreePolicyTests(unittest.TestCase):
    def test_declared_free_roads_require_their_own_valid_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'Testland.csv'
            text=CatalogTests().fixture()+"# freeRoads=T2,T3\n# freeRoadSource=https://example.test/statute\n"
            source.write_text(text);pack.package(source,root)
            for invalid in [text.replace('freeRoadSource=https://','freeRoadSource=http://'),text.replace('freeRoads=T2,T3','freeRoads=T2,T2'),text.replace('freeRoads=T2,T3','freeRoads=')]:
                source.write_text(invalid)
                with self.assertRaises(ValueError): pack.package(source,root)

class OfficialMatrixCellTests(unittest.TestCase):
    def test_approved_2026_pairs_have_their_own_publishable_namespace(self):
        assets=ROOT.parent/'android/native-app/src/main/assets/toll-fares/Portugal.csv'
        audit=json.loads((ROOT.parent/'docs/data/portugal-entry-exit-2026-audit.json').read_text())
        self.assertEqual(hashlib.sha256(assets.read_bytes()).hexdigest(),audit['catalogSha256'])
        self.assertEqual(3270,audit['farePairs']);self.assertEqual(13080,audit['sourceCells'])
        self.assertIn('south',audit['excludedDomains'])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);manifest=pack.package(assets,root,'toll-fares')
            self.assertEqual('entry-exit',manifest['scheme']);self.assertEqual(3270,manifest['journeyCount'])
            storage=Storage();publisher.publish(storage,'atlas-regions',root,'toll-fares')
            self.assertEqual('toll-fares/Portugal/manifest.json',storage.writes[-1])
            self.assertTrue(all(k.startswith('toll-fares/') for k in storage.writes))
            with self.assertRaises(ValueError):pack.package(assets,root,'toll-tariffs')
            with self.assertRaises(ValueError):pack.package(assets,root,'toll-charges')

    def test_second_country_entry_exit_table_keeps_ids_and_precision_independent(self):
        text='# country=Testland\n# currency=JPY\n# year=2026\n# version=1\n# fractionDigits=0\n# scheme=entry-exit\n# source=https://example.test/prices\nnetwork;entry;exit;class1;class5\nn;a;b;125;271\nn;b;a;198;315\n'
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'Testland.csv';source.write_text(text)
            manifest=pack.package(source,root,'toll-fares')
            self.assertEqual('JPY',manifest['currency']);self.assertEqual([1,5],manifest['vehicleClasses'])
            for invalid in [text+'n;a;b;1;2\n',text.replace('125;271',';271'),text+'# status=candidate\n',text.replace('125;271','1.25;271')]:
                source.write_text(invalid)
                with self.assertRaises(ValueError):pack.package(source,root,'toll-fares')

    def setUp(self):
        self.extractor=module('import-brisa-fares')
        self.fixture=json.loads((ROOT/'test-fixtures/brisa-matrix-cells.json').read_text())

    def test_real_source_cell_positions_preserve_classes_direction_and_prefixed_station_ids(self):
        for page in self.fixture['pages']:
            cells,_=self.extractor.extract_page(page['spans'])
            self.assertEqual(page['expected'],[[a,b,c,str(price)] for a,b,c,price in cells])
        self.assertIn(['1011','0112',1,'23.20'],self.fixture['pages'][1]['expected'])
        self.assertIn(['0211','0222',2,'41.65'],self.fixture['pages'][2]['expected'])

    def test_unlocated_or_duplicate_prices_fail_instead_of_using_a_neighboring_cell(self):
        spans=self.fixture['pages'][0]['spans']
        price=next(s for s in spans if self.extractor.PRICE.fullmatch(s['text'].strip()))
        with self.assertRaisesRegex(ValueError,'Duplicate fare cell'):
            self.extractor.extract_page(spans+[price])
        displaced=dict(price,bbox=[price['bbox'][0],5000,price['bbox'][2],5004])
        with self.assertRaisesRegex(ValueError,'outside source cell bounds'):
            self.extractor.extract_page([s for s in spans if s is not price]+[displaced])

    def test_candidate_is_complete_per_class_and_keeps_inconsistent_source_dates_visible(self):
        root=ROOT.parent/'docs/data/toll-candidates'
        csv=(root/'Portugal.csv').read_bytes();report=json.loads((root/'Portugal.audit.json').read_text())
        self.assertEqual(hashlib.sha256(csv).hexdigest(),report['csvSha256'])
        self.assertEqual(4170,report['farePairs'])
        self.assertEqual(['01-01-2025'],report['sourceEffectiveDates']['south'])
        self.assertEqual('candidate-not-active-in-routing',report['status'])
        rows=[r.split(';') for r in csv.decode().splitlines() if r and not r.startswith('#')]
        self.assertEqual(4171,len(rows));self.assertTrue(all(len(r)==7 for r in rows))
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError): pack.package(root/'Portugal.csv',Path(temp))

if __name__=='__main__': unittest.main()
