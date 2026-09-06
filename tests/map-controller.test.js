import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MapController,
  assertMapAdapterContract
} from '../src/map/map-controller.js';

const METHODS = [
  'clearItinerary', 'clearNearby', 'clearRoute', 'clearManeuvers',
  'showItinerary', 'focus', 'focusItineraryPlace', 'followPosition',
  'setBearing', 'updateUserLocation', 'setNavigationTravelMode',
  'setGpsDiagnosticsVisible', 'isGpsDiagnosticsVisible',
  'resetGpsDiagnostics', 'setRegion', 'addNearby', 'showRoute',
  'fitRoute', 'updateRouteProgress', 'showManeuvers', 'invalidateSize',
  'onMoveEnd', 'onUserMoveStart', 'onMapClick', 'showSelectionPin',
  'clearSelectionPin', 'closeSelectionPopup'
];

function fakeAdapter({ maplibre = false } = {}) {
  const calls = [];
  const adapter = {};
  if (maplibre) adapter.maplibre = {};

  for (const method of METHODS) {
    adapter[method] = (...args) => {
      calls.push([method, args]);
      return method;
    };
  }
  return { adapter, calls };
}

function callsFor(calls, method) {
  return calls
    .filter(([name]) => name === method)
    .map(([, args]) => args);
}

const ROUTE = {
  points: [
    { lat: 40, lon: -8 },
    { lat: 40, lon: -7.99 },
    { lat: 40, lon: -7.98 }
  ]
};

function progress({
  pointIndex = 0,
  segmentFraction = 0.5,
  distanceFromRouteMeters = 8
} = {}) {
  return {
    pointIndex,
    segmentFraction,
    distanceFromRouteMeters
  };
}

test('map controller rejects incomplete renderer adapters', () => {
  assert.throws(
    () => assertMapAdapterContract({ clearRoute() {} }),
    /missing required methods/
  );
});

test('map controller exposes maneuver and GPS diagnostic operations without adapter leaks', () => {
  const { adapter, calls } = fakeAdapter();
  const map = new MapController({ adapter });

  assert.equal(map.clearManeuvers(), 'clearManeuvers');
  assert.equal(map.resetGpsDiagnostics(), 'resetGpsDiagnostics');
  assert.deepEqual(calls, [
    ['clearManeuvers', []],
    ['resetGpsDiagnostics', []]
  ]);
  assert.equal('adapter' in map, false);
});

test('MapLibre drive cursor stays projected onto the active route during normal GPS drift', () => {
  const { adapter, calls } = fakeAdapter({ maplibre: true });
  const map = new MapController({ adapter });

  map.setNavigationTravelMode('drive');
  map.showRoute(ROUTE);
  map.updateUserLocation({
    latitude: 40.0002,
    longitude: -7.995,
    accuracy: 12,
    heading: 90,
    speed: 8
  });
  map.updateRouteProgress(ROUTE, progress());

  const updates = callsFor(calls, 'updateUserLocation');
  const corrected = updates.at(-1)[0];

  assert.equal(corrected.latitude, 40);
  assert.equal(corrected.longitude, -7.995);
  assert.equal(corrected.accuracy, 12);
});

test('MapLibre drive keeps the cursor route-locked through isolated off-route fixes', () => {
  const { adapter, calls } = fakeAdapter({ maplibre: true });
  const map = new MapController({ adapter });

  map.setNavigationTravelMode('drive');
  map.showRoute(ROUTE);

  for (let index = 0; index < 2; index += 1) {
    map.updateUserLocation({
      latitude: 40.001,
      longitude: -7.995,
      accuracy: 10,
      heading: 90,
      speed: 7
    });
    map.updateRouteProgress(
      ROUTE,
      progress({ distanceFromRouteMeters: 70 })
    );
  }

  const corrected = callsFor(calls, 'updateUserLocation').at(-1)[0];
  assert.equal(corrected.latitude, 40);
  assert.equal(corrected.longitude, -7.995);
});

test('MapLibre drive releases the cursor after repeated confirmed off-route movement', () => {
  const { adapter, calls } = fakeAdapter({ maplibre: true });
  const map = new MapController({ adapter });

  map.setNavigationTravelMode('drive');
  map.showRoute(ROUTE);

  const raw = {
    latitude: 40.001,
    longitude: -7.995,
    accuracy: 10,
    heading: 90,
    speed: 7
  };

  for (let index = 0; index < 3; index += 1) {
    map.updateUserLocation(raw);
    map.updateRouteProgress(
      ROUTE,
      progress({ distanceFromRouteMeters: 70 })
    );
  }

  const displayed = callsFor(calls, 'updateUserLocation').at(-1)[0];
  assert.equal(displayed.latitude, raw.latitude);
  assert.equal(displayed.longitude, raw.longitude);
});

test('MapLibre drive releases the cursor after confirmed opposite-direction travel', () => {
  const { adapter, calls } = fakeAdapter({ maplibre: true });
  const map = new MapController({ adapter });

  map.setNavigationTravelMode('drive');
  map.showRoute(ROUTE);

  const raw = {
    latitude: 40.0002,
    longitude: -7.995,
    accuracy: 8,
    heading: 270,
    speed: 8
  };

  for (let index = 0; index < 2; index += 1) {
    map.updateUserLocation(raw);
    map.updateRouteProgress(ROUTE, progress());
  }

  const displayed = callsFor(calls, 'updateUserLocation').at(-1)[0];
  assert.equal(displayed.latitude, raw.latitude);
  assert.equal(displayed.longitude, raw.longitude);
});

test('MapLibre walk cursor keeps raw GPS coordinates instead of route-locking', () => {
  const { adapter, calls } = fakeAdapter({ maplibre: true });
  const map = new MapController({ adapter });
  const raw = {
    latitude: 40.0002,
    longitude: -7.995,
    accuracy: 12,
    heading: 90,
    speed: 1.5
  };

  map.setNavigationTravelMode('walk');
  map.showRoute(ROUTE);
  map.updateUserLocation(raw);
  map.updateRouteProgress(ROUTE, progress());

  const updates = callsFor(calls, 'updateUserLocation');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0][0], raw);
});

test('Leaflet and other adapters continue receiving raw GPS coordinates', () => {
  const { adapter, calls } = fakeAdapter();
  const map = new MapController({ adapter });
  const raw = {
    latitude: 40.0002,
    longitude: -7.995,
    accuracy: 12,
    heading: 90,
    speed: 8
  };

  map.showRoute(ROUTE);
  map.updateUserLocation(raw);
  map.updateRouteProgress(ROUTE, progress());

  const updates = callsFor(calls, 'updateUserLocation');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0][0], raw);
});
