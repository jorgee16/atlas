import test from 'node:test';
import assert from 'node:assert/strict';

import {
  predictRoutePosition
} from '../src/features/navigation/navigation-tunnel-continuity.js';

test('tunnel prediction advances along route geometry instead of straight line', () => {
  const route = {
    points: [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 },
      { lat: 0.001, lon: 0.001 }
    ]
  };

  const predicted = predictRoutePosition(
    route,
    {
      segmentIndex: 0,
      segmentFraction: 0.9
    },
    35
  );

  assert.ok(predicted);
  assert.equal(predicted.segmentIndex, 1);
  assert.ok(predicted.lat > 0);
  assert.ok(Math.abs(predicted.lon - 0.001) < 1e-8);
  assert.ok(predicted.heading < 1 || predicted.heading > 359);
});

test('tunnel prediction clamps to route destination', () => {
  const route = {
    points: [
      { lat: 40, lon: -8 },
      { lat: 40.001, lon: -8 }
    ]
  };

  const predicted = predictRoutePosition(
    route,
    { segmentIndex: 0, segmentFraction: 0 },
    1000
  );

  assert.deepEqual(
    { lat: predicted.lat, lon: predicted.lon },
    route.points[1]
  );
  assert.equal(predicted.segmentFraction, 1);
});
