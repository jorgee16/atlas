import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GpsController
} from '../src/gps.js';

const METERS_PER_LAT_DEGREE = 111320;

function offsetPoint(
  origin,
  northMeters,
  eastMeters
) {
  const latitude =
    origin.latitude +
    northMeters /
      METERS_PER_LAT_DEGREE;

  const metersPerLonDegree =
    METERS_PER_LAT_DEGREE *
    Math.cos(
      origin.latitude *
      Math.PI /
      180
    );

  const longitude =
    origin.longitude +
    eastMeters /
      metersPerLonDegree;

  return {
    latitude,
    longitude
  };
}

function seededNoise(seed = 123456) {
  let value = seed >>> 0;

  return () => {
    value =
      (
        value * 1664525 +
        1013904223
      ) >>> 0;

    return value / 0xffffffff;
  };
}

function symmetricNoise(random) {
  return random() * 2 - 1;
}

function gpsPosition({
  latitude,
  longitude,
  accuracy,
  heading = null,
  speed = null,
  timestamp = null
}) {
  return {
    timestamp,
    coords: {
      latitude,
      longitude,
      accuracy,
      heading,
      speed
    }
  };
}

test(
  'GPS motion filter rejects stationary noise and follows real noisy movement',
  () => {
    const random =
      seededNoise(42);

    const updates = [];

    const gps =
      new GpsController({
        onUpdate: update =>
          updates.push(update),

        onStatus: () => {}
      });

    const origin = {
      latitude: 51.5155,
      longitude: -0.1754
    };

    let simulatedNow = 0;

      /*
       * -------------------------------------------------
       * PHASE 1
       * Stationary indoors.
       *
       * Position wanders several metres,
       * accuracy varies 20-35 m,
       * provider sometimes claims 1-2 m/s.
       * -------------------------------------------------
       */

      for (let i = 0; i < 12; i++) {
        simulatedNow += 1000;

        const noisy =
          offsetPoint(
            origin,
            symmetricNoise(random) * 2.5,
            symmetricNoise(random) * 2.5
          );

        gps.handlePosition(
          gpsPosition({
            timestamp: simulatedNow,
            ...noisy,

            accuracy:
              20 +
              random() * 15,

            heading:
              random() * 360,

            // Deliberately bogus.
            speed:
              0.8 +
              random() * 1.3
          })
        );
      }

      const stationaryUpdates =
        updates.slice();

      assert.equal(
        stationaryUpdates.at(-1).speed,
        0,
        'stationary GPS drift must not become trusted motion'
      );

      /*
       * -------------------------------------------------
       * PHASE 2
       * Real walking.
       *
       * ~1.4 m/s north-east with ordinary GPS noise.
       * -------------------------------------------------
       */

      const walkingStart =
        updates.length;

      let north = 0;
      let east = 0;

      for (let i = 0; i < 20; i++) {
        simulatedNow += 1000;

        north += 1.15;
        east += 0.8;

        const real =
          offsetPoint(
            origin,
            north,
            east
          );

        const noisy =
          offsetPoint(
            real,
            symmetricNoise(random) * 1.5,
            symmetricNoise(random) * 1.5
          );

        gps.handlePosition(
          gpsPosition({
            timestamp: simulatedNow,
            ...noisy,

            accuracy:
              12 +
              random() * 12,

            heading:
              35 +
              symmetricNoise(random) * 15,

            speed:
              1.0 +
              random() * 1.0
          })
        );
      }

      const walkingUpdates =
        updates.slice(
          walkingStart
        );

      assert.ok(
        walkingUpdates.some(
          update =>
            update.speed > 0
        ),
        'real walking must eventually become confirmed motion'
      );

      const movingWalkingUpdates =
        walkingUpdates.filter(
          update =>
            update.speed > 0
        );

      assert.ok(
        movingWalkingUpdates.length >= 3,
        `expected sustained walking detection, got ${movingWalkingUpdates.length} moving fixes`
      );

      const confirmedWalking =
        movingWalkingUpdates.at(-1);

      assert.ok(
        Number.isFinite(
          confirmedWalking.heading
        ),
        'confirmed walking should produce a usable course heading'
      );

      /*
       * -------------------------------------------------
       * PHASE 3
       * Walking with degraded GPS.
       *
       * Accuracy jumps between 40 and 120 m and position
       * receives occasional much larger errors.
       * -------------------------------------------------
       */

      const poorGpsStart =
        updates.length;

      for (let i = 0; i < 12; i++) {
        simulatedNow += 1000;

        north += 1.15;
        east += 0.8;

        const real =
          offsetPoint(
            origin,
            north,
            east
          );

        const badAccuracy =
          i % 4 === 0
            ? 100 + random() * 20
            : 40 + random() * 30;

        const noiseRadius =
          i % 4 === 0
            ? 18
            : 5;

        const noisy =
          offsetPoint(
            real,
            symmetricNoise(random) *
              noiseRadius,

            symmetricNoise(random) *
              noiseRadius
          );

        gps.handlePosition(
          gpsPosition({
            timestamp: simulatedNow,
            ...noisy,
            accuracy: badAccuracy,

            heading:
              random() * 360,

            speed:
              1 +
              random() * 1.2
          })
        );
      }

      const poorGpsUpdates =
        updates.slice(
          poorGpsStart
        );

      assert.ok(
        poorGpsUpdates.every(
          update =>
            Number.isFinite(
              update.latitude
            ) &&
            Number.isFinite(
              update.longitude
            )
        )
      );

      /*
       * -------------------------------------------------
       * PHASE 4
       * Stop walking.
       *
       * Provider keeps reporting non-zero native speed.
       * -------------------------------------------------
       */

      const stoppedPoint =
        offsetPoint(
          origin,
          north,
          east
        );

      for (let i = 0; i < 10; i++) {
        simulatedNow += 1000;

        const noisy =
          offsetPoint(
            stoppedPoint,
            symmetricNoise(random) * 2,
            symmetricNoise(random) * 2
          );

        gps.handlePosition(
          gpsPosition({
            timestamp: simulatedNow,
            ...noisy,

            accuracy:
              18 +
              random() * 14,

            heading:
              random() * 360,

            // Again deliberately wrong.
            speed:
              1.0 +
              random()
          })
        );
      }

      assert.equal(
        updates.at(-1).speed,
        0,
        'motion must return to zero after stopping despite bogus native speed'
      );
  }
);
