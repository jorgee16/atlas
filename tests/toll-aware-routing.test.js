import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RoutingGraph
} from '../src/routing/routing-graph.js';

import {
  AStarRouter
} from '../src/routing/astar-router.js';

import {
  estimateRouteTolls
} from '../src/routing/portugal-toll-estimator.js';

import {
  selectBalancedDriveRoute
} from '../src/routing/drive-route-options.js';

import {
  createRoutingBuffers
} from './helpers/routing-fixture.js';

function fixture() {
  const nodes = [
    { lat: 40.0000, lon: -8.0000, component: 0 },
    { lat: 40.0000, lon: -7.9900, component: 0 },
    { lat: 40.0000, lon: -7.9800, component: 0 },
    { lat: 40.0100, lon: -7.9900, component: 0 }
  ];

  return new RoutingGraph(createRoutingBuffers({
    nodes,
    roads: [
      { name: 'A1', ref: 'A1', toll: true },
      { name: 'N road', ref: 'N1', toll: false }
    ],
    edges: [
      {
        from: 0,
        to: 1,
        road: 0,
        distanceDecimeters: 100_000,
        durationCentiseconds: 30_000
      },
      {
        from: 1,
        to: 2,
        road: 0,
        distanceDecimeters: 100_000,
        durationCentiseconds: 30_000
      },
      {
        from: 0,
        to: 3,
        road: 1,
        distanceDecimeters: 120_000,
        durationCentiseconds: 45_000
      },
      {
        from: 3,
        to: 2,
        road: 1,
        distanceDecimeters: 120_000,
        durationCentiseconds: 45_000
      }
    ]
  }));
}

test('routing graph preserves OSM toll flags', () => {
  const graph = fixture();
  assert.equal(graph.road(0).toll, true);
  assert.equal(Boolean(graph.road(1).toll), false);
  assert.equal(graph.edgeIsToll(0), true);
});

test('avoidTolls is a hard routing constraint', async () => {
  const graph = fixture();
  const router = new AStarRouter(graph);

  const fastest = await router.route(0, 2, {
    yieldEvery: Infinity
  });

  assert.deepEqual(fastest.nodeIndexes, [0, 1, 2]);
  assert.equal(fastest.durationSeconds, 600);
  assert.ok(estimateRouteTolls(graph, fastest).totalEuros > 0);

  const free = await router.route(0, 2, {
    avoidTolls: true,
    yieldEvery: Infinity
  });

  assert.deepEqual(free.nodeIndexes, [0, 3, 2]);
  assert.equal(free.durationSeconds, 900);
  assert.equal(estimateRouteTolls(graph, free).totalEuros, 0);
});

test('toll penalties can prefer a slower cheaper route without corrupting ETA', async () => {
  const graph = fixture();
  const router = new AStarRouter(graph);

  const route = await router.route(0, 2, {
    tollPenaltyMinutesPerEuro: 7,
    vehicleClass: 1,
    yieldEvery: Infinity
  });

  assert.deepEqual(route.nodeIndexes, [0, 3, 2]);
  assert.equal(route.durationSeconds, 900);
});


test('balanced route prefers the Pareto knee instead of a near no-tolls clone', () => {
  const route = (minutes, tolls) => ({
    durationSeconds: minutes * 60,
    tolls: { totalEuros: tolls }
  });

  const fastest = route(232, 27.40);
  const middle = route(260, 11.50);
  const nearFree = route(300, 0.87);
  const noTolls = route(304, 0);

  const balanced = selectBalancedDriveRoute(
    [fastest, middle, nearFree, noTolls],
    fastest,
    noTolls
  );

  assert.equal(balanced, middle);
});
