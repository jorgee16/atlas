import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMapLibrePmtilesStyle
} from '../src/map/layers/maplibre-pmtiles-style.js';

test('MapLibre PMTiles style registers the protocol and points at the archive', async () => {
  const protocols = new Map();
  const maplibre = {
    addProtocol(name, handler) {
      protocols.set(name, handler);
    }
  };

  const style = await createMapLibrePmtilesStyle({
    url: 'https://example.test/region.pmtiles',
    maplibre,
    fetchFn: async () => ({ ok: true })
  });

  assert.equal(typeof protocols.get('pmtiles'), 'function');
  assert.equal(
    style.sources.atlasOffline.url,
    'pmtiles://https://example.test/region.pmtiles'
  );
  assert.equal(style.sources.atlasOffline.type, 'vector');
  assert.ok(style.layers.some(layer => layer.id === 'atlas-transportation'));
});

test('MapLibre PMTiles style stays unavailable when the archive cannot be read', async () => {
  const style = await createMapLibrePmtilesStyle({
    url: 'https://example.test/missing.pmtiles',
    maplibre: {
      addProtocol() {
        throw new Error('should not register protocol');
      }
    },
    fetchFn: async () => ({ ok: false })
  });

  assert.equal(style, null);
});
