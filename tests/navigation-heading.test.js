import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blendHeadings,
  carNavigationHeading,
  carRouteHeadingWeight,
  headingDelta,
  smoothHeading
} from '../src/map/navigation-heading.js';

test('heading blending follows the shortest path across north', () => {
  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(10, 350), -20);
  assert.ok(
    Math.abs(blendHeadings(350, 10, 0.5)) < 0.001
  );
});

test('car heading trusts the route more at low speed and while well matched', () => {
  const lowSpeedWeight = carRouteHeadingWeight({
    speed: 2,
    accuracy: 8,
    distanceFromRouteMeters: 4,
    gpsHeading: 70,
    routeHeading: 90
  });

  const highSpeedWeight = carRouteHeadingWeight({
    speed: 20,
    accuracy: 8,
    distanceFromRouteMeters: 4,
    gpsHeading: 70,
    routeHeading: 90
  });

  assert.ok(lowSpeedWeight > highSpeedWeight);
  assert.ok(lowSpeedWeight > 0.7);
});

test('car heading gives GPS more authority as the vehicle leaves the route', () => {
  const onRouteWeight = carRouteHeadingWeight({
    speed: 12,
    accuracy: 10,
    distanceFromRouteMeters: 5,
    gpsHeading: 20,
    routeHeading: 90
  });

  const offRouteWeight = carRouteHeadingWeight({
    speed: 12,
    accuracy: 10,
    distanceFromRouteMeters: 65,
    gpsHeading: 20,
    routeHeading: 90
  });

  assert.ok(offRouteWeight < onRouteWeight * 0.6);

  const heading = carNavigationHeading({
    speed: 12,
    accuracy: 10,
    distanceFromRouteMeters: 65,
    gpsHeading: 20,
    routeHeading: 90
  });

  assert.ok(Math.abs(headingDelta(20, heading)) < 30);
});

test('heading smoothing does not jump through 180 degrees at north', () => {
  const smoothed = smoothHeading(350, 10, 0.5);
  assert.ok(Math.abs(smoothed) < 0.001);
});
