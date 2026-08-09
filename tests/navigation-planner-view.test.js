import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NavigationPlannerView
} from '../src/features/navigation/navigation-planner-view.js';

class FakeElement {
  constructor() {
    this.className = '';
    this.innerHTML = '';
  }
}

test(
  'navigation starts as a compact map-first destination search with collapsed origin controls',
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
      'navigation-planner navigation-planner--compact'
    );
    assert.match(element.innerHTML, /Where do you want to go\?/);
    assert.match(element.innerHTML, />From</);
    assert.match(element.innerHTML, />My location</);
    assert.match(
      element.innerHTML,
      /Search a place, airport or address/
    );
    assert.match(
      element.innerHTML,
      /data-navigation-origin-editor hidden/
    );
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
