import test from 'node:test';
import assert from 'node:assert/strict';

import { calibrateDriveEta } from '../src/routing/drive-eta.js';

test('short urban drive ETA is more conservative than free-flow edge time', () => {
  const route = {
    distanceMeters: 3_100,
    durationSeconds: 180,
    legs: [
      {
        roadIndex: 1,
        roadClass: 3,
        road: { roundabout: false },
        distanceMeters: 3_100,
        durationSeconds: 180,
        routeDurationStartSeconds: 0,
        routeDurationEndSeconds: 180
      }
    ]
  };

  const calibrated = calibrateDriveEta(route);

  assert.equal(calibrated.freeFlowDurationSeconds, 180);
  assert.ok(calibrated.durationSeconds >= 220);
  assert.ok(calibrated.durationSeconds < 300);
  assert.equal(
    calibrated.legs[0].routeDurationEndSeconds,
    calibrated.durationSeconds
  );
});

test('drive ETA never makes a slow mapped edge faster', () => {
  const route = {
    distanceMeters: 500,
    durationSeconds: 120,
    legs: [
      {
        roadIndex: 1,
        roadClass: 6,
        road: { roundabout: false },
        distanceMeters: 500,
        durationSeconds: 120,
        routeDurationStartSeconds: 0,
        routeDurationEndSeconds: 120
      }
    ]
  };

  const calibrated = calibrateDriveEta(route);

  assert.ok(calibrated.durationSeconds >= 140);
  assert.equal(calibrated.legs[0].freeFlowDurationSeconds, 120);
});

test('road changes add bounded junction delay without changing geometry', () => {
  const route = {
    distanceMeters: 1_000,
    durationSeconds: 80,
    points: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }],
    legs: [
      {
        roadIndex: 1,
        roadClass: 5,
        road: { roundabout: false },
        distanceMeters: 500,
        durationSeconds: 40
      },
      {
        roadIndex: 2,
        roadClass: 6,
        road: { roundabout: false },
        distanceMeters: 500,
        durationSeconds: 40
      }
    ]
  };

  const calibrated = calibrateDriveEta(route);

  assert.equal(calibrated.points, route.points);
  assert.ok(calibrated.legs[1].durationSeconds > 40);
  assert.equal(
    calibrated.legs[1].routeDurationStartSeconds,
    calibrated.legs[0].routeDurationEndSeconds
  );
});
