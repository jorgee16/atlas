import test from 'node:test';
import assert from 'node:assert/strict';

import { RoutingGraph } from '../src/routing/routing-graph.js';
import { OfflineRoutingService } from '../src/routing/offline-routing-service.js';
import { createRoutingBuffers } from './helpers/routing-fixture.js';

function graphForLongRoad() {
  return new RoutingGraph(
    createRoutingBuffers({
      nodes: [
        { lat: 40, lon: -8.0100, component: 0 },
        { lat: 40, lon: -8.0000, component: 0 },
        { lat: 40, lon: -7.9900, component: 0 }
      ],
      edges: [
        {
          from: 0,
          to: 1,
          distanceDecimeters: 8_530,
          durationCentiseconds: 6_000
        },
        {
          from: 1,
          to: 2,
          distanceDecimeters: 8_530,
          durationCentiseconds: 6_000
        }
      ]
    })
  );
}

test(
  'drive route stops at the projected road point instead of the road-end node',
  async () => {
    const graph = graphForLongRoad();
    const service = new OfflineRoutingService({
      repository: {
        loadForEndpoints: async () => ({
          region: { id: 'portugal' },
          graph
        })
      },
      maximumSnapDistanceMeters: 2_000
    });

    const destination = {
      lat: 40.00002,
      lon: -7.9950
    };

    const route = await service.route(
      { lat: 40, lon: -8.0099 },
      destination,
      { profile: 'drive' }
    );

    const lastPoint = route.points.at(-1);

    assert.equal(route.destinationSnap.snapStrategy, 'road-segment-destination');
    assert.ok(Math.abs(lastPoint.lat - 40) < 0.00005);
    assert.ok(Math.abs(lastPoint.lon - destination.lon) < 0.0001);

    // The old node-only behavior continued another ~425 m to -7.9900.
    assert.ok(Math.abs(lastPoint.lon - (-7.9900)) > 0.003);
  }
);
