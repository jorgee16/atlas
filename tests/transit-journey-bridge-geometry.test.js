import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryPoints } from '../src/transit/transit-journey-bridge.js';

test('parses Atlas Transit JSON-string [lat, lon] geometry', () => {
  assert.deepEqual(
    geometryPoints('[[51.501,-0.1246],[51.5392,-0.1426]]'),
    [
      { lat: 51.501, lon: -0.1246 },
      { lat: 51.5392, lon: -0.1426 }
    ]
  );
});

test('parses already-decoded [lat, lon] geometry', () => {
  assert.deepEqual(
    geometryPoints([[51.501, -0.1246], [51.5392, -0.1426]]),
    [
      { lat: 51.501, lon: -0.1246 },
      { lat: 51.5392, lon: -0.1426 }
    ]
  );
});

test('keeps WKT LINESTRING(lon lat) compatibility', () => {
  assert.deepEqual(
    geometryPoints('LINESTRING(-0.1246 51.501,-0.1426 51.5392)'),
    [
      { lat: 51.501, lon: -0.1246 },
      { lat: 51.5392, lon: -0.1426 }
    ]
  );
});
