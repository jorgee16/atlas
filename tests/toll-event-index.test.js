import test from 'node:test';
import assert from 'node:assert/strict';

import { TollEventIndex } from '../src/routing/toll-event-index.js';
import {
  estimateEdgeTollEuros,
  estimateRouteTolls
} from '../src/routing/portugal-toll-estimator.js';

function index() {
  return new TollEventIndex({
    version: 1,
    partitionId: 'mainland',
    edges: [
      {
        edgeIndex: 10,
        events: [
          {
            id: 'A16:01',
            roadRef: 'A16',
            system: 'traditional-plaza',
            tariffs: { '1': 0.65, '2': 1.15 }
          }
        ]
      },
      {
        edgeIndex: 20,
        events: [
          {
            id: 'A16:03',
            roadRef: 'A16',
            system: 'traditional-plaza',
            tariffs: { '1': 1.2, '2': 2.1 }
          }
        ]
      },
      {
        edgeIndex: 21,
        events: [
          {
            id: 'A16:03',
            roadRef: 'A16',
            system: 'traditional-plaza',
            tariffs: { '1': 1.2, '2': 2.1 }
          }
        ]
      }
    ]
  });
}

test('free A16 edge is not tolled when official crossing assets exist', () => {
  const tollEvents = index();

  assert.equal(tollEvents.edgeHasCharge(5, 1), false);
  assert.equal(tollEvents.edgeHasCharge(10, 1), true);
});

test('official route tolls charge only crossed physical events', () => {
  const graph = {
    tollEvents: index()
  };

  const free = estimateRouteTolls(
    graph,
    { edgeIndexes: [1, 2, 3, 4, 5] },
    { vehicleClass: 1 }
  );

  const ranholas = estimateRouteTolls(
    graph,
    { edgeIndexes: [1, 20, 21, 30] },
    { vehicleClass: 1 }
  );

  assert.equal(free.totalEuros, 0);
  assert.equal(free.source, 'official-events');
  assert.equal(ranholas.totalEuros, 1.2);
  assert.equal(ranholas.events.length, 1);
  assert.equal(ranholas.events[0].id, 'A16:03');
});

test('paired edges for the same toll event are charged once per route', () => {
  const graph = {
    tollEvents: index()
  };

  const result = estimateRouteTolls(
    graph,
    { edgeIndexes: [20, 21] },
    { vehicleClass: 2 }
  );

  assert.equal(result.totalEuros, 2.1);
  assert.equal(result.events.length, 1);
});

test('edge toll penalty uses exact official tariff', () => {
  const graph = {
    tollEvents: index()
  };

  assert.equal(estimateEdgeTollEuros(graph, 10, 1), 0.65);
  assert.equal(estimateEdgeTollEuros(graph, 20, 1), 1.2);
  assert.equal(estimateEdgeTollEuros(graph, 5, 1), 0);
});
