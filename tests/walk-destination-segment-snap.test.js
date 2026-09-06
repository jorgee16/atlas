import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RoutingGraph
} from '../src/routing/routing-graph.js';
import {
  OfflineRoutingService
} from '../src/routing/offline-routing-service.js';
import {
  createRoutingBuffers
} from './helpers/routing-fixture.js';

function createWalkGraph() {
  return new RoutingGraph(
    createRoutingBuffers({
      nodes: [
        { lat: 40.0, lon: -8.0, component: 0 },
        { lat: 40.0, lon: -7.9900, component: 0 }
      ],
      edges: [
        {
          from: 0,
          to: 1,
          distanceDecimeters: 8_500,
          durationCentiseconds: 60_700,
          driveAllowed: false,
          walkAllowed: true
        },
        {
          from: 1,
          to: 0,
          distanceDecimeters: 8_500,
          durationCentiseconds: 60_700,
          driveAllowed: false,
          walkAllowed: true
        }
      ]
    })
  );
}

test(
  'walking route stops at projected destination point instead of road end node',
  async () => {
    const graph = createWalkGraph();
    const service = new OfflineRoutingService({
      repository: {
        loadForEndpoints: async () => ({
          region: { id: 'portugal' },
          graph
        })
      },
      maximumSnapDistanceMeters: 1_000
    });

    const destination = {
      lat: 40.00002,
      lon: -7.9950
    };

    const route = await service.route(
      { lat: 40.0, lon: -8.0 },
      destination,
      { profile: 'walk' }
    );

    assert.equal(route.profile, 'walk');
    assert.equal(
      route.destinationSnap.snapStrategy,
      'walk-road-segment-destination'
    );

    const lastPoint = route.points.at(-1);
    assert.ok(Math.abs(lastPoint.lon - destination.lon) < 0.00005);
    assert.ok(Math.abs(lastPoint.lat - 40.0) < 0.00005);

    // The old node snap would continue to -7.9900, roughly another 425 m.
    assert.ok(lastPoint.lon < -7.9949);
    assert.ok(route.distanceMeters < 600);
  }
);
