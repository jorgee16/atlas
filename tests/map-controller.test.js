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

function fakeAdapter() {
  const calls = [];
  const adapter = {};
  for (const method of METHODS) {
    adapter[method] = (...args) => {
      calls.push([method, args]);
      return method;
    };
  }
  return { adapter, calls };
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
