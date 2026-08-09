import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TripCatalog
} from '../src/features/trip/trip-catalog.js';

test('trip catalog loads and resolves relative trip URLs', async () => {
  const catalog = new TripCatalog({
    url: 'https://example.com/trips/catalog.json',
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        version: 1,
        trips: [
          {
            id: 'london-2026',
            name: 'London 2026',
            url: '/trips/london-2026.json'
          }
        ]
      })
    })
  });

  const trips = await catalog.list();

  assert.equal(trips.length, 1);
  assert.equal(trips[0].id, 'london-2026');
  assert.equal(
    trips[0].url,
    'https://example.com/trips/london-2026.json'
  );
});

test('trip catalog rejects unsupported formats', async () => {
  const catalog = new TripCatalog({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        version: 99,
        trips: []
      })
    })
  });

  await assert.rejects(
    () => catalog.list(),
    /unsupported format/
  );
});
