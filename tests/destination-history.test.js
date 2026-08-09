import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DestinationHistory
} from '../src/features/navigation/destination-history.js';

test('recent destinations are deduplicated and newest first', () => {
  const values = new Map();
  const history = new DestinationHistory({
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    }
  });

  history.add({
    id: 'tower',
    name: 'Tower Bridge',
    lat: 51.5055,
    lon: -0.0754
  });

  history.add({
    id: 'palace',
    name: 'Buckingham Palace',
    lat: 51.5014,
    lon: -0.1419
  });

  history.add({
    id: 'tower',
    name: 'Tower Bridge',
    lat: 51.5055,
    lon: -0.0754
  });

  assert.deepEqual(
    history.list().map(item => item.id),
    ['tower', 'palace']
  );
});
