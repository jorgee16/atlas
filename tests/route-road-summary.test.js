import assert from 'node:assert/strict';
import test from 'node:test';

import {
  summarizeRouteRoadRefs
} from '../src/routing/route-road-summary.js';

test('route road summary keeps principal road refs in journey order', () => {
  const roads = [
    { ref: 'N125' },
    { ref: 'A2' },
    { ref: 'A22' },
    { ref: '' }
  ];

  const edgeRoads = [0, 0, 1, 1, 1, 2, 3];
  const edgeDistances = [
    10000,
    12000,
    100000,
    120000,
    90000,
    60000,
    500
  ];

  const graph = {
    edgeRoad: edgeIndex => edgeRoads[edgeIndex],
    road: roadIndex => roads[roadIndex],
    edgeDistanceDecimeters: edgeIndex =>
      edgeDistances[edgeIndex] * 10
  };

  const route = {
    edgeIndexes: edgeRoads.map((_, index) => index),
    distanceMeters: edgeDistances.reduce((sum, value) => sum + value, 0)
  };

  assert.deepEqual(
    summarizeRouteRoadRefs(graph, route),
    ['N125', 'A2', 'A22']
  );
});

test('route road summary drops tiny signed access roads on long trips', () => {
  const roads = [
    { ref: 'N1' },
    { ref: 'A1' },
    { ref: 'N17' }
  ];

  const distances = [200, 180000, 15000];
  const graph = {
    edgeRoad: edgeIndex => edgeIndex,
    road: roadIndex => roads[roadIndex],
    edgeDistanceDecimeters: edgeIndex => distances[edgeIndex] * 10
  };

  const route = {
    edgeIndexes: [0, 1, 2],
    distanceMeters: distances.reduce((sum, value) => sum + value, 0)
  };

  assert.deepEqual(
    summarizeRouteRoadRefs(graph, route),
    ['A1', 'N17']
  );
});


test('route road summary normalizes compound Portuguese road refs', () => {
  const roads = [
    { ref: 'A 13;IC 3' },
    { ref: 'EN 365' }
  ];
  const edgeRoads = [0, 0, 1];
  const distances = [20000, 25000, 15000];
  const graph = {
    edgeRoad: edgeIndex => edgeRoads[edgeIndex],
    road: roadIndex => roads[roadIndex],
    edgeDistanceDecimeters: edgeIndex => distances[edgeIndex] * 10
  };
  const route = {
    edgeIndexes: [0, 1, 2],
    distanceMeters: distances.reduce((sum, value) => sum + value, 0)
  };

  assert.deepEqual(
    summarizeRouteRoadRefs(graph, route),
    ['A13', 'IC3', 'EN365']
  );
});


test('route road summary normalizes verbose Portuguese road references', () => {
  const roads = [
    { ref: 'Estrada Municipal 526-1' },
    { ref: 'EM 526' },
    { ref: 'Estrada Nacional 395' },
    { ref: 'Itinerario Complementar 3' }
  ];
  const edgeRoads = [0, 1, 2, 3];
  const graph = {
    edgeRoad: edgeIndex => edgeRoads[edgeIndex],
    road: roadIndex => roads[roadIndex],
    edgeDistanceDecimeters: () => 10000
  };
  const route = {
    edgeIndexes: edgeRoads.map((_, index) => index),
    distanceMeters: 4000
  };

  assert.deepEqual(
    summarizeRouteRoadRefs(graph, route),
    ['EM526-1', 'EM526', 'EN395', 'IC3']
  );
});
