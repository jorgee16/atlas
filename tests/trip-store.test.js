import test from 'node:test';
import assert from 'node:assert/strict';

import { TripStore } from '../src/features/trip/trip-store.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const makeTrip = name => ({
  trip: {
    name,
    days: {
      '1': [{ name: `${name} stop`, lat: 51.5, lon: -0.1 }]
    }
  }
});

test('TripStore keeps imported trips and restores the active trip', () => {
  const storage = new MemoryStorage();
  const store = new TripStore({ storage });

  const london = store.upsert(makeTrip('London'), { sourceName: 'london.json' });
  const porto = store.upsert(makeTrip('Porto'), { sourceName: 'porto.json' });

  let state = store.load();
  assert.equal(state.trips.length, 2);
  assert.equal(state.activeId, porto.id);

  store.setActive(london.id);
  state = new TripStore({ storage }).load();
  assert.equal(state.activeId, london.id);
  assert.equal(state.trips.find(trip => trip.id === london.id)?.data.trip.name, 'London');
});

test('re-importing the same trip file updates it instead of duplicating it', () => {
  const storage = new MemoryStorage();
  const store = new TripStore({ storage });

  store.upsert(makeTrip('London'), { sourceName: 'london.json' });
  store.upsert(makeTrip('London'), { sourceName: 'london.json' });

  assert.equal(store.load().trips.length, 1);
});


test('trip.id is canonical across renamed imports and preserves thumbnail metadata', () => {
  const storage = new MemoryStorage();
  const store = new TripStore({ storage });

  const original = {
    trip: {
      id: 'london-2026',
      name: 'London 2026',
      days: {
        '12': [{ name: 'Big Ben', lat: 51.500729, lon: -0.124625 }]
      }
    }
  };

  const withThumbnail = structuredClone(original);
  withThumbnail.trip.days['12'][0].image = 'https://example.test/big-ben.webp';

  store.upsert(original, { sourceName: 'london-trip.json' });
  const updated = store.upsert(withThumbnail, {
    sourceName: 'london-trip-thumbnails.json'
  });

  const state = store.load();
  assert.equal(state.trips.length, 1);
  assert.equal(state.activeId, 'trip:london-2026');
  assert.equal(updated.id, 'trip:london-2026');
  assert.equal(
    state.trips[0].data.trip.days['12'][0].image,
    'https://example.test/big-ben.webp'
  );
});
