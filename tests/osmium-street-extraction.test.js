import assert from 'node:assert/strict';
import test from 'node:test';
import { filterExpression } from '../tools/region-builder/adapters/osmium-adapter.mjs';

test('named road ways survive the OSM extraction for offline street search', () => {
  const expressions = filterExpression({
    cafe: [{ key: 'amenity', values: ['cafe'] }]
  });
  assert.ok(expressions.includes('w/highway'),
    'without w/highway the street normalizer never sees unnumbered roads');
  assert.ok(expressions.includes('nwr/addr:housenumber'));
  assert.ok(expressions.includes('nwr/amenity=cafe'));
  assert.equal(expressions.filter(x => x === 'w/highway').length, 1);
});
