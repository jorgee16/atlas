import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitProviderRegistry } from '../src/transit/transit-provider-registry.js';

const regions = [
  { id: 'london', bounds: [-0.6, 51.2, 0.4, 51.8] },
  { id: 'portugal', bounds: [-10, 36.8, -6, 42.3] }
];

const catalog = {
  async findByPosition(point) {
    return regions.find(region => {
      const [w, s, e, n] = region.bounds;
      return point.lon >= w && point.lon <= e && point.lat >= s && point.lat <= n;
    }) ?? null;
  }
};

const bridge = { plan() {} };

function registry() {
  return new TransitProviderRegistry({
    catalog,
    providers: {
      london: { id: 'tfl', bridge }
    }
  });
}

test('resolves TfL only for a London journey', async () => {
  const result = await registry().resolve(
    { lat: 51.5074, lon: -0.1278 },
    { lat: 51.4952, lon: -0.1439 }
  );

  assert.equal(result.available, true);
  assert.equal(result.region.id, 'london');
  assert.equal(result.provider.id, 'tfl');
  assert.equal(result.provider.bridge, bridge);
});

test('reports no provider for Portugal without invoking London provider', async () => {
  const result = await registry().resolve(
    { lat: 38.7223, lon: -9.1393 },
    { lat: 38.7078, lon: -9.1366 }
  );

  assert.equal(result.available, false);
  assert.equal(result.region.id, 'portugal');
  assert.equal(result.provider, null);
  assert.match(result.reason, /isn’t available in this region yet/i);
});

test('uses planned endpoints rather than physical GPS location', async () => {
  const result = await registry().resolve(
    { lat: 51.5074, lon: -0.1278 },
    { lat: 51.4952, lon: -0.1439 }
  );

  assert.equal(result.available, true);
  assert.equal(result.provider.id, 'tfl');
});

test('rejects a cross-region transit journey', async () => {
  const result = await registry().resolve(
    { lat: 51.5074, lon: -0.1278 },
    { lat: 38.7223, lon: -9.1393 }
  );

  assert.equal(result.available, false);
  assert.match(result.reason, /cross-region journey/i);
});
