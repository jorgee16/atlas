import test from 'node:test';
import assert from 'node:assert/strict';

import { GpsController } from '../src/gps.js';
import {
  googleWalkingDirections
} from '../src/utils.js';

test(
  'GPS validates movement before exposing navigation speed',
  () => {
    const updates = [];

    const gps = new GpsController({
      onUpdate: value => {
        updates.push(value);
      },
      onStatus: () => {}
    });

    // A single GPS fix cannot prove movement.
    // Raw provider speed must therefore not enable prediction.
    gps.handlePosition({
      coords: {
        latitude: 40.2,
        longitude: -8.4,
        accuracy: 8,
        heading: 135,
        speed: 2.5
      }
    });

    assert.deepEqual(updates[0], {
      latitude: 40.2,
      longitude: -8.4,
      accuracy: 8,
      heading: 135,
      speed: 0
    });

    // Simulate three seconds passing, followed by about
    // 11 metres of real displacement.
    gps.courseAnchor.timestamp -= 3000;

    gps.handlePosition({
      coords: {
        latitude: 40.20010,
        longitude: -8.4,
        accuracy: 8,
        heading: 135,
        speed: 2.5
      }
    });

    assert.equal(
      updates[1].speed > 0,
      true
    );

    assert.equal(
      Number.isFinite(updates[1].heading),
      true
    );
  }
);

test(
  'Google directions use coordinates without a London suffix',
  () => {
    const url = googleWalkingDirections({
      name: 'Praça do Comércio',
      lat: 38.7078,
      lon: -9.1366
    });

    assert.match(
      url,
      /destination=38\.7078%2C-9\.1366/
    );

    assert.doesNotMatch(url, /London/);
  }
);
