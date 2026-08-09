import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RoutingGraph
} from '../src/routing/routing-graph.js';

import {
  AStarRouter
} from '../src/routing/astar-router.js';

import {
  ManeuverGenerator
} from '../src/routing/maneuver-generator.js';

import {
  findRouteProgress,
  routeCumulativeDistances
} from '../src/routing/route-progress.js';

import {
  createRoutingBuffers
} from './helpers/routing-fixture.js';

async function buildRoute({
  nodes,
  edges,
  roads,
  restrictions = [],
  start = 0,
  goal = nodes.length - 1,
  destination = { name: 'Destination' }
}) {
  const graph = new RoutingGraph(
    createRoutingBuffers({
      nodes,
      edges,
      roads,
      restrictions
    })
  );

  const route = await new AStarRouter(
    graph
  ).route(start, goal, {
    yieldEvery: Infinity
  });

  route.maneuvers =
    new ManeuverGenerator().generate({
      graph,
      route,
      destination
    });

  route.cumulativeDistances =
    routeCumulativeDistances(
      route.points
    );

  return { graph, route };
}

test(
  'named road changes produce a clean intersection turn instruction',
  async () => {
    const { graph, route } =
      await buildRoute({
        nodes: [
          { lat: 40, lon: -8 },
          { lat: 40, lon: -7.999 },
          { lat: 39.999, lon: -7.999 }
        ],
        roads: [
          {
            name: 'Rua da Sofia',
            ref: 'N1'
          },
          {
            name: 'Avenida Central'
          }
        ],
        edges: [
          {
            from: 0,
            to: 1,
            road: 0,
            distanceDecimeters: 1_000,
            durationCentiseconds: 1_000
          },
          {
            from: 1,
            to: 2,
            road: 1,
            distanceDecimeters: 1_000,
            durationCentiseconds: 1_000
          }
        ]
      });

    assert.deepEqual(
      route.maneuvers.map(({ type }) => type),
      ['depart', 'turn-right', 'arrive']
    );

    assert.equal(
      route.maneuvers[1].instruction,
      'Turn right onto Avenida Central'
    );

    assert.deepEqual(
      graph.road(0),
      {
        id: 0,
        name: 'Rua da Sofia',
        ref: 'N1',
        destination: '',
        lanes: '',
        turnLanes: '',
        destinationLanes: '',
        roundabout: false,
        link: false
      }
    );

    const departure = findRouteProgress(
      { lat: 40, lon: -8 },
      route
    );

    assert.equal(
      departure.nextManeuver.type,
      'depart'
    );

    const progress = findRouteProgress(
      { lat: 40, lon: -7.9996 },
      route,
      { previousPointIndex: 0 }
    );

    assert.equal(
      progress.nextManeuver.type,
      'turn-right'
    );
    assert.ok(
      progress.distanceToManeuverMeters > 50
    );
  }
);

test(
  'roundabout guidance counts legal exits and names the selected road',
  async () => {
    const { route } = await buildRoute({
      nodes: [
        { lat: 40, lon: -8.003 },
        { lat: 40, lon: -8.002 },
        { lat: 39.999, lon: -8.001 },
        { lat: 40, lon: -8 },
        { lat: 40, lon: -7.999 },
        { lat: 39.998, lon: -8.001 }
      ],
      goal: 4,
      roads: [
        { name: 'Rua de Entrada' },
        {
          name: 'Rotunda do Centro',
          roundabout: true
        },
        { name: 'Avenida da República' },
        { name: 'Rua Sul' }
      ],
      edges: [
        { from: 0, to: 1, road: 0 },
        { from: 1, to: 2, road: 1, oneWay: true },
        { from: 2, to: 3, road: 1, oneWay: true },
        { from: 3, to: 4, road: 2 },
        {
          from: 2,
          to: 5,
          road: 3,
          durationCentiseconds: 4_000
        }
      ]
    });

    const roundabout = route.maneuvers.find(
      maneuver =>
        maneuver.type === 'roundabout'
    );

    assert.equal(roundabout.exitNumber, 2);
    assert.match(
      roundabout.instruction,
      /2nd exit onto Avenida da República/
    );
  }
);

test(
  'A* keeps separate incoming-road states at restricted intersections',
  async () => {
    const { route } = await buildRoute({
      nodes: [
        { lat: 40, lon: -8 },
        { lat: 40, lon: -7.999 },
        { lat: 40, lon: -7.998 },
        { lat: 40.001, lon: -7.999 }
      ],
      goal: 2,
      roads: [
        { name: 'Approach' },
        { name: 'Forbidden turn' },
        { name: 'Legal detour' },
        { name: 'Return road' }
      ],
      edges: [
        {
          from: 0,
          to: 1,
          road: 0,
          durationCentiseconds: 100
        },
        {
          from: 1,
          to: 2,
          road: 1,
          durationCentiseconds: 100
        },
        {
          from: 1,
          to: 3,
          road: 2,
          durationCentiseconds: 150
        },
        {
          from: 3,
          to: 2,
          road: 3,
          durationCentiseconds: 150
        }
      ],
      restrictions: [
        {
          viaNode: 1,
          fromRoad: 0,
          toRoad: 1,
          only: false
        }
      ]
    });

    assert.deepEqual(
      route.nodeIndexes,
      [0, 1, 3, 2]
    );
  }
);

test(
  'only-turn restrictions reject every unlisted outgoing road',
  async () => {
    const { route } = await buildRoute({
      nodes: [
        { lat: 40, lon: -8 },
        { lat: 40, lon: -7.999 },
        { lat: 40, lon: -7.998 },
        { lat: 39.999, lon: -7.999 }
      ],
      goal: 3,
      roads: [
        { name: 'Approach' },
        { name: 'Unlisted shortcut' },
        { name: 'Required turn' }
      ],
      edges: [
        {
          from: 0,
          to: 1,
          road: 0,
          durationCentiseconds: 100
        },
        {
          from: 1,
          to: 2,
          road: 1,
          durationCentiseconds: 50
        },
        {
          from: 2,
          to: 3,
          road: 1,
          durationCentiseconds: 50
        },
        {
          from: 1,
          to: 3,
          road: 2,
          durationCentiseconds: 300
        }
      ],
      restrictions: [
        {
          viaNode: 1,
          fromRoad: 0,
          toRoad: 2,
          only: true
        }
      ]
    });

    assert.deepEqual(
      route.nodeIndexes,
      [0, 1, 3]
    );
  }
);

test(
  'same-way no-u-turn restrictions still allow straight travel',
  async () => {
    const { route } = await buildRoute({
      nodes: [
        { lat: 40, lon: -8 },
        { lat: 40, lon: -7.999 },
        { lat: 40, lon: -7.998 }
      ],
      goal: 2,
      roads: [
        { name: 'Avenida Longa' }
      ],
      edges: [
        { from: 0, to: 1, road: 0 },
        { from: 1, to: 0, road: 0 },
        { from: 1, to: 2, road: 0 }
      ],
      restrictions: [
        {
          viaNode: 1,
          fromRoad: 0,
          toRoad: 0,
          only: false
        }
      ]
    });

    assert.deepEqual(
      route.nodeIndexes,
      [0, 1, 2]
    );
  }
);


test(
  'turn lane metadata propagates to the maneuver and recommends matching lanes',
  async () => {
    const { graph, route } = await buildRoute({
      nodes: [
        { lat: 40, lon: -8 },
        { lat: 40, lon: -7.999 },
        { lat: 39.999, lon: -7.999 }
      ],
      roads: [
        {
          name: 'Approach',
          lanes: '3',
          turnLanesForward: 'left|through|right',
          destinationLanes: 'Centro|Centro|Sul'
        },
        { name: 'Exit road' }
      ],
      edges: [
        { from: 0, to: 1, road: 0 },
        { from: 1, to: 2, road: 1 }
      ]
    });

    assert.equal(
      graph.road(0).turnLanes,
      'left|through|right'
    );

    assert.deepEqual(
      route.maneuvers[1].lanes.map(lane => ({
        indication: lane.indication,
        recommended: lane.recommended
      })),
      [
        { indication: 'left', recommended: false },
        { indication: 'through', recommended: false },
        { indication: 'right', recommended: true }
      ]
    );
  }
);
