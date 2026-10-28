import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countryTollTariffs, parseTollTable } from '../src/routing/country-toll-tariffs.js';
import { countryTollFares } from '../src/routing/country-toll-tariffs.js';
import { estimateRouteTolls } from '../src/routing/portugal-toll-estimator.js';
import { selectBalancedDriveRoute } from '../src/routing/drive-route-options.js';

test('web and native use identical official class prices and exclusions', () => {
  const bytes = readFileSync(new URL('../android/native-app/src/main/assets/tolls/Portugal.csv', import.meta.url), 'utf8');
  const native = parseTollTable('Portugal', bytes), web = countryTollTariffs('Portugal');
  for (const c of [1,2,3,4]) assert.equal(native.estimate('A5',23800,c), web.estimate('A5',23800,c));
  assert.ok(Math.abs(web.estimate('A5',23800,1)-2.5)<1e-9);
  for (const c of [2,3,4]) assert.ok(Math.abs(web.estimate('A5',23800,c)-4.8)<1e-9);
  for (const ref of ['A2','A4','A12','A13','A17','A41','unknown']) assert.equal(web.estimate(ref,1000,1),null);
  assert.equal(countryTollTariffs('Spain'),null);
  assert.equal(web.estimate('A5',1000,5),null);
});
test('official entry/exit catalog is directed and cannot become a km estimate', () => {
  const pt=countryTollFares('Portugal');
  assert.equal(pt.scheme,'entry-exit');assert.equal(pt.estimate('A3',10000,1),null);
  assert.equal(pt.entryExitFare({network:'brisa-published',entry:'0311',exit:'0316'},1),3.85);
  assert.equal(pt.entryExitFare({network:'brisa-published',entry:'0311',exit:'0316'},4),9.60);
  assert.equal(pt.entryExitFare({network:'brisa-published',entry:'1411',exit:'0117'},1),2.90);
  assert.equal(pt.entryExitFare({network:'brisa-published',entry:'0211',exit:'0222'},1),null);
  assert.equal(countryTollFares('Spain'),null);
});
test('another country can supply asymmetric entry/exit fares without guessed reverse or zero cells', () => {
  const csv='# country=Testland\n# currency=JPY\n# year=2026\n# version=1\n# fractionDigits=0\n# scheme=entry-exit\n# source=https://example.test/matrix\nnetwork;entry;exit;class1;class5\nn;a;b;125;271\nn;b;a;198;315\nn;a;a;500;900\n';
  const t=parseTollTable('Testland',csv),a={network:'n',entry:'a',exit:'b'},b={network:'n',entry:'b',exit:'a'};
  assert.equal(t.entryExitFare(a,5),271);assert.equal(t.entryExitFare(b,1),198);
  assert.equal(t.entryExitFare({network:'n',entry:'a',exit:'a'},1),500);
  assert.equal(t.sumEntryExitFares([a,a],1),250);
  assert.equal(t.entryExitFare({...a,exit:'missing'},1),null);
  assert.equal(t.entryExitFare(a,4),null);
  assert.throws(()=>parseTollTable('Testland',csv+'n;a;b;1;2\n'));
  assert.throws(()=>parseTollTable('Testland',csv.replace('125;271',';271')));
  assert.throws(()=>parseTollTable('Testland',csv+'# status=candidate\n'));
});
test('another country needs only a table, with independent currency and classes', () => {
  const csv='# country=Testland\n# currency=JPY\n# year=2026\n# fractionDigits=0\n# source=https://example.test/fixture\nroad;section;km;class1;class5\nT1;paid;10;100;230\nT0;free;1;0;0\n';
  const table=parseTollTable('Testland',csv);
  assert.equal(table.estimate('T1',10000,5),230);assert.equal(table.currency,'JPY');
  assert.equal(table.estimate('T0',1000,1),0);assert.equal(table.estimate('A5',1000,1),null);
  assert.throws(()=>parseTollTable('Portugal',csv));
  assert.throws(()=>parseTollTable('Testland',csv+'T1;paid;1;1;2\n'));
  assert.throws(()=>parseTollTable('Testland',csv.replace('230','NaN')));
});
test('unpriced tolls remain null and are never treated as a free alternative', () => {
  const graph={ edgeIsToll:()=>true,edgeRoad:()=>0,road:()=>({ref:'A404'}),edgeDistanceDecimeters:()=>10000 };
  const strictCsv=readFileSync(new URL('../android/native-app/src/main/assets/tolls/Portugal.csv',import.meta.url),'utf8').split('\n').filter(l=>!l.startsWith('# referenceEstimate=')&&!l.startsWith('# referenceSourceRoads=')).join('\n');
  const result=estimateRouteTolls(graph,{edgeIndexes:[0]},{tariffs:parseTollTable('Portugal',strictCsv)});
  assert.equal(result.totalEuros,null);assert.equal(result.pricing,'unavailable');assert.equal(result.roads[0].euros,null);
  graph.edgeIsToll=()=>false;
  assert.equal(estimateRouteTolls(graph,{edgeIndexes:[0]}).totalEuros,0);
  const fastest={durationSeconds:100,tolls:{totalEuros:null}},free={durationSeconds:200,tolls:{totalEuros:0}};
  assert.equal(selectBalancedDriveRoute([fastest,free],fastest,free),null);
});

test('web UI does not display unknown costs as zero or a foreign currency as EUR', async () => {
  const { tollPriceLabel } = await import('../src/routing/toll-price-label.js');
  assert.match(tollPriceLabel({ totalEuros:null, tolledDistanceMeters:100 }), /unavailable/);
  assert.equal(tollPriceLabel({ totalEuros:0, tolledDistanceMeters:0 }),'No toll roads');
  assert.doesNotMatch(tollPriceLabel({ totalEuros:100, tolledDistanceMeters:100, currency:'JPY', vehicleClass:5 }), /€/);
});

test('official plaza prices are independent of km and retain repeated real crossings', async () => {
  const {countryTollCharges}=await import('../src/routing/country-toll-tariffs.js');
  const c=countryTollCharges('Portugal');
  assert.equal(c.scheme,'fixed-crossing');assert.equal(c.fixedCharges.length,10);
  assert.equal(c.fixedCharges.filter(x=>x.road==='A5').length,6);
  assert.deepEqual(Object.fromEntries(c.fixedCharges.filter(x=>x.road==='A5').map(x=>[x.id,x.name])),{
    'brisa:0505':'Oeiras II','brisa:0501':'Carcavelos PV','brisa:0502':'Carcavelos I',
    'brisa:0503':'Carcavelos II','brisa:0504':'Oeiras I','brisa:0506':'Estoril'
  });
  assert.equal(c.fixedCharge('brisa:0501',1),1.6);
  for(const klass of [2,3,4]) assert.equal(c.fixedCharge('brisa:0501',klass),3.1);
  assert.equal(c.sumFixedCharges(['brisa:0502','brisa:0503'],1),1.6);
  assert.equal(c.sumFixedCharges(['brisa:0502','brisa:0502'],1),1.4);
  assert.equal(c.sumFixedCharges(['unknown'],1),null);
  assert.equal(c.estimate('A5',1000,1),null);
  assert.equal(countryTollTariffs('Portugal').fixedCharge('brisa:0501',1),null);
  assert.equal(countryTollCharges('Spain'),null);
});


test('statutory zero is explicit, class checked, country scoped and not an unknown-road default', () => {
  const pt=countryTollTariffs('Portugal');
  for(const ref of ['A22','A23','A24','A25','A 25;IP5']) for(const vehicleClass of [1,2,3,4]) {
    assert.equal(pt.estimate(ref,50000,vehicleClass),0);assert.equal(pt.explicitlyFree(ref,vehicleClass),true);
  }
  for(const ref of ['A4','A13','A28','A25;A1','A1;A25','unknown'])assert.equal(pt.estimate(ref,1000,1),null);
  assert.equal(pt.estimate('A25',1000,99),null);
  const graph={edgeIsToll:()=>true,edgeRoad:()=>0,road:()=>({ref:'A25;IP5'}),edgeDistanceDecimeters:()=>10000};
  const result=estimateRouteTolls(graph,{edgeIndexes:[0]},{tariffs:pt});
  assert.equal(result.amount,0);assert.equal(result.pricing,'exact');assert.equal(result.estimated,false);
  assert.match(result.source,/diariodarepublica/);
  const bytes=readFileSync(new URL('../android/native-app/src/main/assets/tolls/Portugal.csv',import.meta.url),'utf8');
  assert.throws(()=>parseTollTable('Portugal',bytes.replace('# freeRoadSource=https://','# freeRoadSource=http://')));
  assert.throws(()=>parseTollTable('Portugal',bytes.replace('freeRoads=A22,A23,A24,A25','freeRoads=A22,A22')));
});

test('explicit zero prices use the exact label, not an estimate', async () => {
  const {tollPriceLabel}=await import('../src/routing/toll-price-label.js');
  assert.doesNotMatch(tollPriceLabel({totalEuros:0,tolledDistanceMeters:100,currency:'EUR',vehicleClass:1,pricing:'exact'}),/Est\./);
  assert.match(tollPriceLabel({totalEuros:0,tolledDistanceMeters:100,currency:'EUR',vehicleClass:1,pricing:'exact'}),/exact/);
});

test('national reference coverage is opt-in, low confidence, independent by class and never rounds unknown costs to zero', async()=> {
 const pt=countryTollTariffs('Portugal');
 const csv=readFileSync(new URL('../android/native-app/src/main/assets/tolls/Portugal.csv',import.meta.url),'utf8');
 for(const vehicleClass of [1,2,3,4]) {
  for(const ref of ['A2','A4','A7','A11','A12','A13','A13-1','A16','A17','A19','A28','A29','A33','A41','A42','PVG;IP1','']) {
   const graph={edgeIsToll:()=>true,edgeRoad:()=>0,road:()=>({ref}),edgeDistanceDecimeters:()=>100000};
   const r=estimateRouteTolls(graph,{edgeIndexes:[0]},{tariffs:pt,vehicleClass});
   if(ref==='A41'&&vehicleClass>=3){assert.equal(r.amount,0);assert.equal(r.pricing,'exact');continue;}
   assert.ok(r.amount>0,ref);assert.equal(r.pricing,'estimate');assert.equal(r.pricingConfidence,'low');
   assert.equal(r.pricedTollMeters,0);assert.equal(r.referenceTollMeters,10000);
  }
 }
 const graph={edgeIsToll:()=>true,edgeRoad:()=>0,road:()=>({ref:'unpriced'}),edgeDistanceDecimeters:()=>1};
 const tiny=estimateRouteTolls(graph,{edgeIndexes:[0]},{tariffs:pt});assert.equal(tiny.amount,.01);
 assert.equal(estimateRouteTolls(graph,{edgeIndexes:[0]},{tariffs:pt,vehicleClass:99}).amount,null);
 assert.equal(pt.referenceEstimate('A25;A1',1000,1),null);
 const {tollPriceLabel}=await import('../src/routing/toll-price-label.js');assert.match(tollPriceLabel(tiny),/low confidence/);
 for(const invalid of [csv.replace('referenceEstimate=road-then-country-average','referenceEstimate=guess'),csv.replace('referenceSourceRoads=A1,','referenceSourceRoads=missing,'),csv.replace('freeRoadClasses=A41:3,4','freeRoadClasses=A41:3,3')])assert.throws(()=>parseTollTable('Portugal',invalid));
});
