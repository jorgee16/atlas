import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NavigationPlannerView
} from '../src/features/navigation/navigation-planner-view.js';

class FakeElement {
  constructor() {
    this.className = '';

    this.classList = {
      add: (...names) => {
        const classes = new Set(
          this.className.split(/\s+/).filter(Boolean)
        );

        for (const name of names) {
          classes.add(name);
        }

        this.className = [...classes].join(' ');
      },

      remove: (...names) => {
        const removed = new Set(names);

        this.className = this.className
          .split(/\s+/)
          .filter(
            name =>
              name &&
              !removed.has(name)
          )
          .join(' ');
      },

      contains: name =>
        this.className
          .split(/\s+/)
          .filter(Boolean)
          .includes(name),

      toggle: (name, force) => {
        const present = this.className
          .split(/\s+/)
          .filter(Boolean)
          .includes(name);

        const shouldAdd =
          force === undefined
            ? !present
            : Boolean(force);

        if (shouldAdd) {
          this.classList.add(name);
        } else {
          this.classList.remove(name);
        }

        return shouldAdd;
      }
    };
    this.innerHTML = '';
  }
}

test(
  'navigation starts destination-first and keeps custom origin controls out of the default flow',
  () => {
    const view = new NavigationPlannerView({
      documentRef: {
        createElement: () =>
          new FakeElement()
      }
    });

    const element = view.render({
      origin: {
        name: 'My location',
        lat: 38.72,
        lon: -9.14
      },
      originMode: 'gps',
      destination: null,
      query: '',
      results: [],
      state: 'idle',
      error: null,
      pickMode: null,
      onUseGps() {},
      onPick() {},
      onSearch() {},
      onSelect() {},
      onStart() {}
    });

    assert.equal(
      element.className,
      'navigation-planner navigation-planner--compact navigation-planner--search'
    );
    assert.doesNotMatch(element.innerHTML, /Where do you want to go\?/);
    assert.match(element.innerHTML, /navigation-search-grabber/);
    assert.match(element.innerHTML, /navigation-where-to-search/);
    assert.doesNotMatch(element.innerHTML, />From</);
    assert.doesNotMatch(element.innerHTML, />To</);
    assert.match(element.innerHTML, /Where to\?/);
    assert.match(element.innerHTML, /Use my location/);
    assert.match(element.innerHTML, /Pick on map/);
    assert.match(element.innerHTML, /Advanced route/);
    assert.match(
      element.innerHTML,
      /data-navigation-pick="destination"/
    );
    assert.doesNotMatch(
      element.innerHTML,
      /Start navigation/
    );
    assert.doesNotMatch(
      element.innerHTML,
      /data-navigation-swap/
    );
  }
);


test(
  'advanced route planner exposes searchable From and To endpoints with swap and GPS recovery',
  () => {
    const view = new NavigationPlannerView({
      documentRef: { createElement: () => new FakeElement() }
    });

    const element = view.render({
      origin: { name: 'My location', lat: 37.1, lon: -8.2 },
      originMode: 'gps',
      destination: { name: 'Coimbra', lat: 40.21, lon: -8.43 },
      advancedPlannerOpen: true,
      searchTarget: 'origin',
      query: '',
      results: [],
      state: 'idle',
      error: null,
      pickMode: null,
      onUseGps() {},
      onPick() {},
      onSwap() {},
      onCloseAdvancedPlanner() {},
      onActivateEndpoint() {},
      onSearch() {},
      onSelect() {}
    });

    assert.match(element.innerHTML, /Route planner/);
    assert.match(element.innerHTML, /data-navigation-close-advanced/);
    assert.match(element.innerHTML, /Back to simple navigation search/);
    assert.match(element.innerHTML, />From</);
    assert.match(element.innerHTML, />To</);
    assert.match(element.innerHTML, /Search starting point/);
    assert.match(element.innerHTML, />Coimbra</);
    assert.match(element.innerHTML, /data-navigation-swap/);
    assert.match(element.innerHTML, /Use my location/);
    assert.doesNotMatch(
      element.innerHTML,
      /data-navigation-use-gps[^>]*disabled/
    );
    assert.match(element.innerHTML, /data-navigation-pick="origin"/);
  }
);

test(
  'ready route preview keeps Start reachable in collapsed map-first state',
  () => {
    const view = new NavigationPlannerView({
      documentRef: {
        createElement: () => new FakeElement()
      }
    });

    const element = view.render({
      origin: { name: 'My location', lat: 38.72, lon: -9.14 },
      originMode: 'gps',
      destination: { name: 'Cascais', lat: 38.7, lon: -9.42 },
      query: '',
      results: [],
      state: 'idle',
      error: null,
      pickMode: null,
      previewState: 'ready',
      previewCollapsed: true,
      previewRoute: {
        durationSeconds: 720,
        distanceMeters: 8_400
      },
      onChangeDestination() {},
      onExpandPreview() {},
      onStart() {}
    });

    assert.match(element.innerHTML, /navigation-preview-bar/);
    assert.match(element.innerHTML, /12 min/);
    assert.match(element.innerHTML, /8\.4 km/);
    assert.match(element.innerHTML, /data-navigation-start/);
    assert.doesNotMatch(element.innerHTML, /navigation-confirm-card--preview/);
  }
);

test('drive preview hides regional transit-unavailable notice until Transit is selected', () => {
  const view = new NavigationPlannerView({
    documentRef: { createElement: () => new FakeElement() }
  });

  const base = {
    origin: { name: 'My location', lat: 37.75, lon: -25.6 },
    originMode: 'gps',
    destination: { name: '9700-213', lat: 37.76, lon: -25.58 },
    query: '',
    results: [],
    state: 'idle',
    error: null,
    pickMode: null,
    previewState: 'ready',
    previewCollapsed: false,
    previewRoute: { durationSeconds: 240, distanceMeters: 3_100 },
    driveRoutes: [],
    transitAvailability: {
      status: 'unavailable',
      message: 'Public transport routing isn’t available in this region yet.'
    },
    onChangeDestination() {},
    onStart() {}
  };

  const drive = view.render({ ...base, travelMode: 'drive' });
  assert.doesNotMatch(drive.innerHTML, /Public transport routing isn’t available/);
  assert.match(drive.innerHTML, /data-navigation-change/);
  assert.match(drive.innerHTML, />Search<\/button>/);

  const transit = view.render({ ...base, travelMode: 'transit' });
  assert.match(transit.innerHTML, /Public transport routing isn’t available/);
});
