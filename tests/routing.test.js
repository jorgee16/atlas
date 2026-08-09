import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RoutingGraph
} from '../src/routing/routing-graph.js';

import {
  AStarRouter
} from '../src/routing/astar-router.js';

import {
  OfflineRoutingService
} from '../src/routing/offline-routing-service.js';

import {
  RoutingRepository
} from '../src/routing/routing-repository.js';

import {
  createRoutingBuffers
} from './helpers/routing-fixture.js';

const nodes = [
  { lat: 40.0000, lon: -8.0000, component: 0 },
  { lat: 40.0000, lon: -7.9990, component: 0 },
  { lat: 40.0000, lon: -7.9980, component: 0 },
  { lat: 40.0010, lon: -7.9990, component: 0 },
  { lat: 37.7400, lon: -25.6700, component: 1 }
];

const edges = [
  {
    from: 0,
    to: 1,
    distanceDecimeters: 850,
    durationCentiseconds: 1_000
  },
  {
    from: 1,
    to: 2,
    distanceDecimeters: 850,
    durationCentiseconds: 1_000
  },
  {
    from: 0,
    to: 3,
    distanceDecimeters: 1_400,
    durationCentiseconds: 400,
    geometry: [
      { lat: 40.0004, lon: -7.9996 }
    ]
  },
  {
    from: 3,
    to: 2,
    distanceDecimeters: 1_400,
    durationCentiseconds: 400,
    geometry: [
      { lat: 40.0005, lon: -7.9985 }
    ]
  }
];

function createGraph() {
  return new RoutingGraph(
    createRoutingBuffers({
      nodes,
      edges
    })
  );
}

test(
  'binary routing graph snaps endpoints through its uniform grid',
  () => {
    const graph = createGraph();

    const snapped = graph.findNearest(
      {
        lat: 40.00002,
        lon: -7.99904
      },
      {
        maxDistanceMeters: 100
      }
    );

    assert.equal(snapped.node, 1);
    assert.ok(snapped.distanceMeters < 10);

    assert.equal(
      graph.edge(0).durationCentiseconds,
      1_000
    );

    assert.equal(
      graph.edge(0).roadClass,
      6
    );

    assert.equal(
      graph.findNearest(
        { lat: 41, lon: -8 },
        { maxDistanceMeters: 50 }
      ),
      null
    );
  }
);

test(
  'A* chooses the fastest directed route rather than the shortest geometry',
  async () => {
    const graph = createGraph();
    const router = new AStarRouter(graph);

    const route = await router.route(
      0,
      2,
      {
        yieldEvery: Infinity
      }
    );

    assert.deepEqual(
      route.nodeIndexes,
      [0, 3, 2]
    );

    assert.equal(route.durationSeconds, 8);
    assert.equal(route.distanceMeters, 280);
    assert.equal(route.points.length, 5);
    assert.deepEqual(
      route.points.map(point => [
        Number(point.lat.toFixed(4)),
        Number(point.lon.toFixed(4))
      ]),
      [
        [40, -8],
        [40.0004, -7.9996],
        [40.001, -7.999],
        [40.0005, -7.9985],
        [40, -7.998]
      ]
    );

    assert.equal(
      await router.route(
        2,
        0,
        { yieldEvery: Infinity }
      ),
      null
    );
  }
);

test(
  'A* rejects endpoints in disconnected island components before traversal',
  async () => {
    const graph = createGraph();
    const router = new AStarRouter(graph);

    assert.equal(
      await router.route(
        0,
        4,
        { yieldEvery: Infinity }
      ),
      null
    );
  }
);

test(
  'contracted edges restore road geometry in both travel directions',
  async () => {
    const buffers = createRoutingBuffers({
      nodes: nodes.slice(0, 2),
      edges: [
        {
          from: 0,
          to: 1,
          distanceDecimeters: 850,
          durationCentiseconds: 500,
          geometry: [
            { lat: 40.0002, lon: -7.9997 },
            { lat: 40.0001, lon: -7.9993 }
          ]
        },
        {
          from: 1,
          to: 0,
          distanceDecimeters: 850,
          durationCentiseconds: 500,
          geometryArc: 0,
          geometryReversed: true
        }
      ]
    });

    const graph = new RoutingGraph(buffers);
    const router = new AStarRouter(graph);

    const route = await router.route(
      1,
      0,
      { yieldEvery: Infinity }
    );

    assert.deepEqual(
      route.points.map(point =>
        Number(point.lon.toFixed(4))
      ),
      [-7.999, -7.9993, -7.9997, -8]
    );
  }
);

test(
  'offline routing service returns snapped real-road route details',
  async () => {
    const graph = createGraph();

    const service =
      new OfflineRoutingService({
        repository: {
          loadForEndpoints: async () => ({
            region: { id: 'portugal' },
            graph
          })
        },
        maximumSnapDistanceMeters: 200
      });

    const route = await service.route(
      {
        lat: 40,
        lon: -8
      },
      {
        lat: 40,
        lon: -7.998
      }
    );

    assert.equal(route.regionId, 'portugal');
    assert.equal(route.profile, 'drive');
    assert.deepEqual(
      route.nodeIndexes,
      [0, 3, 2]
    );
  }
);

test(
  'routing repository loads only the partition shared by both endpoints',
  async () => {
    const buffers = createRoutingBuffers({
      nodes,
      edges
    });

    const requestedUrls = [];

    const portugal = {
      id: 'portugal',
      name: 'Portugal',
      routing: {
        partitions: [
          {
            id: 'mainland',
            bounds: [-9.7, 36.8, -6, 42.3],
            metadata: '/routing/mainland/metadata.json',
            nodes: '/routing/mainland/nodes.bin',
            edges: '/routing/mainland/edges.bin',
            geometry: '/routing/mainland/geometry.bin',
            roads: '/routing/mainland/roads.bin',
            strings: '/routing/mainland/strings.bin',
            restrictions:
              '/routing/mainland/restrictions.bin',
            spatialIndex:
              '/routing/mainland/spatial-index.bin'
          },
          {
            id: 'madeira',
            bounds: [-17.5, 32.4, -16, 33.3],
            metadata: '/routing/madeira/metadata.json',
            nodes: '/routing/madeira/nodes.bin',
            edges: '/routing/madeira/edges.bin',
            geometry: '/routing/madeira/geometry.bin',
            roads: '/routing/madeira/roads.bin',
            strings: '/routing/madeira/strings.bin',
            restrictions:
              '/routing/madeira/restrictions.bin',
            spatialIndex:
              '/routing/madeira/spatial-index.bin'
          }
        ]
      }
    };

    const repository = new RoutingRepository({
      regionRepository: {
        findByPosition: async () => portugal
      },
      baseUrl: '/',
      fetchFn: async url => {
        requestedUrls.push(url);

        if (url.endsWith('metadata.json')) {
          return new Response(
            JSON.stringify(buffers.metadata),
            {
              headers: {
                'content-type':
                  'application/json'
              }
            }
          );
        }

        const buffer =
          url.endsWith('nodes.bin')
            ? buffers.nodes
            : url.endsWith('edges.bin')
              ? buffers.edges
              : url.endsWith('geometry.bin')
                ? buffers.geometry
                : url.endsWith('roads.bin')
                  ? buffers.roads
                  : url.endsWith('strings.bin')
                    ? buffers.strings
                    : url.endsWith('restrictions.bin')
                      ? buffers.restrictions
                      : buffers.spatialIndex;

        return new Response(
          buffer.slice(0)
        );
      }
    });

    const dataset =
      await repository.loadForEndpoints(
        { lat: 40, lon: -8 },
        { lat: 40.01, lon: -7.99 }
      );

    assert.equal(
      dataset.partitionId,
      'mainland'
    );

    assert.equal(
      requestedUrls.every(url =>
        url.includes('/mainland/')
      ),
      true
    );

    await assert.rejects(
      repository.loadForEndpoints(
        { lat: 40, lon: -8 },
        { lat: 32.7, lon: -16.9 }
      ),
      /disconnected routing partitions/
    );
  }
);

test(
  'routing profiles use only edges allowed for that transport mode',
  async () => {
    const profileNodes = [
      { lat: 40.0, lon: -8.0, component: 0 },
      { lat: 40.0, lon: -7.999, component: 0 },
      { lat: 40.001, lon: -7.999, component: 0 },
      { lat: 40.0, lon: -7.998, component: 0 }
    ];

    const graph = new RoutingGraph(
      createRoutingBuffers({
        nodes: profileNodes,
        edges: [
          {
            from: 0,
            to: 1,
            distanceDecimeters: 700,
            durationCentiseconds: 900,
            driveAllowed: false,
            walkAllowed: true
          },
          {
            from: 1,
            to: 3,
            distanceDecimeters: 700,
            durationCentiseconds: 900,
            driveAllowed: false,
            walkAllowed: true
          },
          {
            from: 0,
            to: 2,
            distanceDecimeters: 1_300,
            durationCentiseconds: 400,
            driveAllowed: true,
            walkAllowed: true
          },
          {
            from: 2,
            to: 3,
            distanceDecimeters: 1_300,
            durationCentiseconds: 400,
            driveAllowed: true,
            walkAllowed: true
          }
        ]
      })
    );

    const router = new AStarRouter(graph);

    const drive = await router.route(0, 3, {
      profile: 'drive',
      yieldEvery: Infinity
    });

    const walk = await router.route(0, 3, {
      profile: 'walk',
      yieldEvery: Infinity
    });

    assert.deepEqual(drive.nodeIndexes, [0, 2, 3]);
    assert.deepEqual(walk.nodeIndexes, [0, 1, 3]);
    assert.equal(graph.edge(0).driveAllowed, false);
    assert.equal(graph.edge(0).walkAllowed, true);
  }
);
