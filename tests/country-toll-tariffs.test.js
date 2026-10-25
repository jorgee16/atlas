import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countryTollTariffs, parseTollTable } from '../src/routing/country-toll-tariffs.js';
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
  const result=estimateRouteTolls(graph,{edgeIndexes:[0]},{tariffs:countryTollTariffs('Portugal')});
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
