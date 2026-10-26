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

if __name__=='__main__': unittest.main()
