import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FollowModeController
} from '../src/features/follow/follow-mode-controller.js';

import {
  routeBearingFromProgress,
  splitRouteAtProgress
} from '../src/features/navigation/navigation-route-visuals.js';

class FakeButton {
  constructor() {
    this.hidden = false;
    this.listeners = new Map();
    this.attributes = new Map();
    this.styleValues = new Map();
    this.classList = {
      toggle: () => {}
    };
    this.style = {
      setProperty: (name, value) => {
        this.styleValues.set(name, value);
      }
    };
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  click() {
    this.listeners.get('click')?.();
  }
}

test(
  'route progress splits traveled gray geometry from the remaining route',
  () => {
    const points = [
      { lat: 38, lon: -9 },
      { lat: 38, lon: -8.99 },
      { lat: 38.01, lon: -8.99 },
      { lat: 38.02, lon: -8.99 }
    ];

    const split = splitRouteAtProgress(
      points,
      {
        pointIndex: 1,
        segmentFraction: 0.5
      }
    );

    assert.ok(
      Math.abs(
        split.traveled.at(-1).lat -
        38.005
      ) < 1e-10
    );

    assert.equal(
      split.traveled.at(-1).lon,
      -8.99
    );

    assert.deepEqual(
      split.remaining[0],
      split.traveled.at(-1)
    );

    assert.equal(split.traveled.length, 3);
    assert.equal(split.remaining.length, 3);

    assert.ok(
      routeBearingFromProgress(
        points,
        {
          pointIndex: 1,
          segmentFraction: 0.5
        }
      ) < 1
    );
  }
);

test(
  'navigation start automatically recenters and enables Follow mode',
  () => {
    const calls = [];
    const compassButton = new FakeButton();

    const controller =
      new FollowModeController({
        map: {
          followPosition: (_position, options) => {
            calls.push(['follow', options]);
            return options.headingUp ? 92 : 0;
          },
          focus: (...args) =>
            calls.push(['focus', ...args]),
          setBearing: value =>
            calls.push(['bearing', value]),
          onUserMoveStart: () => {}
        },
        mapContext: {
          showFollowing: () => {},
          showExploring: () => {},
          showIdle: () => {}
        },
        followButton: new FakeButton(),
        recenterButton: new FakeButton(),
        compassButton,
        status: () => {}
      });

    controller.updatePosition({
      latitude: 38.73,
      longitude: -9.41,
      heading: 92,
      speed: 8
    });

    controller.setNavigationActive(true);

    assert.equal(controller.isFollowing(), true);
    assert.equal(compassButton.hidden, false);
    assert.equal(
      compassButton.styleValues.get(
        '--map-bearing'
      ),
      '92deg'
    );
    assert.deepEqual(
      calls.find(([name]) => name === 'follow'),
      ['follow', { zoom: 18, headingUp: true }]
    );

    compassButton.click();

    assert.equal(controller.isFollowing(), true);
    assert.equal(
      compassButton.attributes.get(
        'aria-pressed'
      ),
      'false'
    );
    assert.deepEqual(calls.at(-1), ['bearing', 0]);

    const followCallsBeforePreview =
      calls.filter(([name]) =>
        name === 'follow'
      ).length;

    controller.setNavigationActive(
      true,
      { trackPosition: false }
    );

    controller.updatePosition({
      latitude: 39,
      longitude: -8,
      heading: 180,
      speed: 10
    });

    assert.equal(
      calls.filter(([name]) =>
        name === 'follow'
      ).length,
      followCallsBeforePreview
    );

    assert.equal(compassButton.hidden, true);
  }
);
