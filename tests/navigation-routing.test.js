import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NavigationFeature
} from '../src/features/navigation/navigation-feature.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.type = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }
}

const documentRef = {
  createElement: tagName =>
    new FakeElement(tagName)
};

function routeResult() {
  return {
    points: [
      { lat: 40, lon: -8 },
      { lat: 40.01, lon: -7.99 }
    ],
    distanceMeters: 2_400,
    durationSeconds: 240,
    expandedNodes: 37,
    originSnap: {
      distanceMeters: 4,
      point: { lat: 40, lon: -8 }
    },
    destinationSnap: {
      distanceMeters: 6,
      point: { lat: 40.01, lon: -7.99 }
    }
  };
}

function createFeature(
  routingService,
  overrides = {}
) {
  const calls = [];
  const listElement = new FakeElement();

  const feature = new NavigationFeature({
    map: {
      clearRoute: () =>
        calls.push(['clearRoute']),
      showRoute: (route, endpoints) =>
        calls.push([
          'showRoute',
          route,
          endpoints
        ]),
      updateRouteProgress: (
        route,
        progress
      ) => calls.push([
        'updateRouteProgress',
        route,
        progress
      ]),
      showManeuvers: (
        maneuvers,
        activeIndex
      ) => calls.push([
        'showManeuvers',
        maneuvers,
        activeIndex
      ])
    },
    panelController: {
      show: (...args) =>
        calls.push(['show', ...args]),
      showMode: (...args) =>
        calls.push(['showMode', ...args])
    },
    listElement,
    status: (...args) =>
      calls.push(['status', ...args]),
    routingService,
    documentRef,
    ...overrides
  });

  return {
    feature,
    calls,
    listElement
  };
}

test(
  'navigation waits for offline A* and draws the returned road route',
  async () => {
    const route = routeResult();

    const { feature, calls, listElement } =
      createFeature({
        route: async () => route
      });

    const started = await feature.start({
      origin: {
        name: 'My location',
        lat: 40,
        lon: -8
      },
      destination: {
        name: 'Destination',
        lat: 40.01,
        lon: -7.99
      }
    });

    assert.equal(started, true);
    assert.equal(feature.isActive(), true);

    assert.equal(
      calls.some(
        ([name, value]) =>
          name === 'showRoute' &&
          value === route
      ),
      true
    );

    assert.equal(
      calls.some(
        ([name, value]) =>
          name === 'updateRouteProgress' &&
          value === route
      ),
      true
    );

    const summary =
      listElement.children[0]
        .children[1];

    assert.match(summary.innerHTML, /2\.4 km/);
    assert.match(summary.innerHTML, /4 min/);
    assert.match(summary.innerHTML, /Navigating offline/);
  }
);

test(
  'navigation recalculates after GPS moves off the route',
  async () => {
    let now = 0;
    let routeCalls = 0;

    const { feature, calls } = createFeature(
      {
        route: async () => {
          routeCalls += 1;
          return routeResult();
        }
      },
      {
        now: () => now
      }
    );

    await feature.start({
      origin: { lat: 40, lon: -8 },
      destination: {
        name: 'Destination',
        lat: 40.01,
        lon: -7.99
      }
    });

    now = 20_000;

    feature.updatePosition({
      lat: 40.1,
      lon: -8.1,
      accuracy: 8
    });

    now = 21_500;
    feature.updatePosition({
      lat: 40.1,
      lon: -8.1,
      accuracy: 8
    });

    now = 23_000;
    feature.updatePosition({
      lat: 40.1,
      lon: -8.1,
      accuracy: 8
    });

    await new Promise(resolve =>
      setImmediate(resolve)
    );

    assert.equal(routeCalls, 2);

    assert.equal(
      calls.filter(
        ([name]) => name === 'showRoute'
      ).length,
      2
    );
  }
);

test(
  'poor GPS accuracy does not trigger rerouting from a single off-route fix',
  async () => {
    let now = 0;
    let routeCalls = 0;

    const { feature } = createFeature(
      {
        route: async () => {
          routeCalls += 1;
          return routeResult();
        }
      },
      { now: () => now }
    );

    await feature.start({
      origin: { lat: 40, lon: -8 },
      destination: { name: 'Destination', lat: 40.01, lon: -7.99 }
    });

    now = 20_000;
    feature.updatePosition({
      lat: 40.1,
      lon: -8.1,
      accuracy: 90
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(routeCalls, 1);
    assert.equal(feature.navigationConfidenceState, 'reduced');
  }
);

test(
  'navigation reports missing routing assets without pretending it started',
  async context => {
    context.mock.method(
      console,
      'error',
      () => {}
    );

    const { feature, calls } =
      createFeature({
        route: async () => {
          throw new Error(
            'Portugal routing assets are missing.'
          );
        }
      });

    const started = await feature.start({
      origin: { lat: 40, lon: -8 },
      destination: {
        name: 'Destination',
        lat: 40.01,
        lon: -7.99
      }
    });

    assert.equal(started, false);

    assert.equal(
      calls.some(call =>
        call[0] === 'status' &&
        call[1] ===
          'Offline route unavailable'
      ),
      true
    );
  }
);

test(
  'active guidance stays over the map without replacing the current panel mode',
  async () => {
    const route = {
      ...routeResult(),
      maneuvers: [
        {
          type: 'turn-right',
          instruction: 'Turn right onto Avenida Central',
          routeDistanceMeters: 1_200,
          location: { lat: 40.005, lon: -7.995 }
        },
        {
          type: 'arrive',
          instruction: 'Arrive at Destination',
          routeDistanceMeters: 2_400,
          location: { lat: 40.01, lon: -7.99 }
        }
      ],
      cumulativeDistances:
        new Float64Array([0, 2_400])
    };

    const guidanceCalls = [];

    const guidance = {
      showLoading: value =>
        guidanceCalls.push(['loading', value]),
      showRoute: value =>
        guidanceCalls.push(['route', value]),
      showError: value =>
        guidanceCalls.push(['error', value]),
      hide: () =>
        guidanceCalls.push(['hide'])
    };

    const { feature, calls } =
      createFeature(
        {
          route: async () => route
        },
        { guidance }
      );

    await feature.start({
      origin: { lat: 40, lon: -8 },
      destination: {
        name: 'Destination',
        lat: 40.01,
        lon: -7.99
      }
    });

    assert.equal(
      calls.some(([name]) =>
        name === 'show' ||
        name === 'showMode'
      ),
      false
    );

    assert.equal(
      guidanceCalls.some(
        ([name]) => name === 'route'
      ),
      true
    );

    assert.equal(
      calls.some(
        ([name]) =>
          name === 'showManeuvers'
      ),
      true
    );
  }
);

test(
  'navigation planner searches from GPS and starts the selected offline destination',
  async () => {
    const routeCalls = [];
    const destinationCalls = [];

    const { feature } = createFeature(
      {
        route: async (origin, destination) => {
          routeCalls.push({ origin, destination });
          return routeResult();
        }
      },
      {
        destinationSearch: async (
          query,
          anchor
        ) => {
          destinationCalls.push({ query, anchor });

          return [{
            id: 'tower-bridge',
            name: 'Tower Bridge',
            amenity: 'attraction',
            lat: 51.5055,
            lon: -0.0754,
            distance: 2_000
          }];
        }
      }
    );

    feature.updatePosition({
      name: 'My location',
      lat: 51.5014,
      lon: -0.1419
    });

    const results =
      await feature.searchPlanner('tower');

    feature.setPlannerDestination(
      results[0]
    );

    const started =
      await feature.startPlannedRoute();

    assert.equal(started, true);
    assert.equal(destinationCalls.length, 1);
    assert.equal(
      destinationCalls[0].anchor.name,
      'My location'
    );
    assert.equal(
      routeCalls[0].destination.name,
      'Tower Bridge'
    );
  }
);

test(
  'a picked starting point stays fixed when real GPS updates arrive',
  async () => {
    let now = 0;
    const routeCalls = [];

    const { feature, calls } = createFeature(
      {
        route: async (origin, destination) => {
          routeCalls.push({ origin, destination });
          return routeResult();
        }
      },
      {
        now: () => now
      }
    );

    feature.updatePosition({
      name: 'My location',
      lat: 38.72,
      lon: -9.14
    });

    assert.equal(
      feature.beginMapPick('origin'),
      true
    );

    assert.equal(
      feature.acceptMapPoint({
        lat: 51.5014,
        lon: -0.1419
      }),
      true
    );

    feature.setPlannerDestination({
      name: 'Tower Bridge',
      lat: 51.5055,
      lon: -0.0754
    });

    await feature.startPlannedRoute();

    now = 20_000;

    feature.updatePosition({
      name: 'My location',
      lat: 38.73,
      lon: -9.15
    });

    await new Promise(resolve =>
      setImmediate(resolve)
    );

    assert.equal(routeCalls.length, 1);
    assert.deepEqual(
      routeCalls[0].origin,
      {
        name: 'Picked starting point',
        lat: 51.5014,
        lon: -0.1419
      }
    );

    assert.equal(
      calls.some(
        ([name, mode]) =>
          name === 'showMode' &&
          mode === 'navigation'
      ),
      false,
      'Navigation map picking must not reopen the draggable sheet.'
    );
  }
);

test(
  'selected destinations preview the route before active guidance starts',
  async () => {
    const route = routeResult();
    const activeChanges = [];
    let routeCalls = 0;

    const { feature, calls } = createFeature(
      {
        route: async () => {
          routeCalls += 1;
          return route;
        }
      },
      {
        onActiveChange: active =>
          activeChanges.push(active)
      }
    );

    feature.updatePosition({
      name: 'My location',
      lat: 40,
      lon: -8
    });

    feature.setPlannerDestination({
      name: 'Destination',
      lat: 40.01,
      lon: -7.99
    });

    await feature.previewPromise;

    assert.equal(feature.isActive(), false);
    assert.equal(feature.getPlannerState().previewState, 'ready');
    assert.equal(feature.getPlannerState().previewRoute, route);
    assert.deepEqual(activeChanges, []);
    assert.equal(
      calls.some(([name, value]) =>
        name === 'showRoute' && value === route
      ),
      true
    );

    const started = await feature.startPlannedRoute();

    assert.equal(started, true);
    assert.equal(feature.isActive(), true);
    assert.deepEqual(activeChanges, [true]);
    assert.equal(routeCalls, 1, 'Start should reuse the previewed route.');
  }
);

test(
  'manual map movement collapses a ready route preview without starting navigation',
  async () => {
    let onUserMoveStart = null;

    const { feature } = createFeature(
      { route: async () => routeResult() },
      {
        map: {
          clearRoute() {},
          showRoute() {},
          clearSelectionPin() {},
          showSelectionPin() {},
          focus() {},
          onUserMoveStart(callback) {
            onUserMoveStart = callback;
          }
        }
      }
    );

    feature.updatePosition({ lat: 40, lon: -8 });
    feature.setPlannerDestination({
      name: 'Destination',
      lat: 40.01,
      lon: -7.99
    });
    await feature.previewPromise;

    assert.equal(feature.getPlannerState().previewCollapsed, false);
    onUserMoveStart();
    assert.equal(feature.getPlannerState().previewCollapsed, true);
    assert.equal(feature.isActive(), false);
  }
);

test(
  'planned navigation preserves itinerary context for arrival handling',
  async () => {
    const route = routeResult();
    const itineraryContext = {
      type: 'itinerary',
      day: '1',
      stopIndex: 0,
      nextStop: { name: 'Next stop', lat: 40.02, lon: -7.98 },
      isFinalStop: false
    };

    const { feature } = createFeature({
      route: async () => route
    });

    feature.updatePosition({
      lat: 40,
      lon: -8,
      accuracy: 5
    });

    feature.setPlannerDestination(
      {
        name: 'Trip stop',
        lat: 40.01,
        lon: -7.99
      },
      { context: itineraryContext }
    );

    await feature.previewPlannedRoute();
    const started = await feature.startPlannedRoute();

    assert.equal(started, true);
    assert.equal(feature.navigationContext, itineraryContext);
  }
);
