import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_ADAPTER_METHODS
} from '../src/map/map-controller.js';
import {
  MapLibreMapAdapter
} from '../src/map/maplibre-map-adapter.js';

test('MapLibre adapter implements the complete map adapter contract', () => {
  for (const method of MAP_ADAPTER_METHODS) {
    assert.equal(
      typeof MapLibreMapAdapter.prototype[method],
      'function',
      `MapLibreMapAdapter is missing ${method}`
    );
  }
});
