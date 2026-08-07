import test from 'node:test';
import assert from 'node:assert/strict';

import { GpsController } from '../src/gps.js';
import {
  googleWalkingDirections
} from '../src/utils.js';

test(
  'GPS updates retain browser heading and speed',
  () => {
    let update = null;

    const gps = new GpsController({
      onUpdate: value => {
        update = value;
      },
      onStatus: () => {}
    });

    gps.handlePosition({
      coords: {
        latitude: 40.2,
        longitude: -8.4,
        accuracy: 8,
        heading: 135,
        speed: 2.5
      }
    });

    assert.deepEqual(update, {
      latitude: 40.2,
      longitude: -8.4,
      accuracy: 8,
      heading: 135,
      speed: 2.5
    });
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
