import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FollowModeController
} from '../src/features/follow/follow-mode-controller.js';

import {
  navigationCameraProfile,
  navigationForwardOffset,
  navigationPitch
} from '../src/map/navigation-camera.js';

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
  'car navigation camera keeps a forward-looking adaptive profile',
  () => {
    const profile = navigationCameraProfile('drive');

    assert.deepEqual(profile, {
      forwardFraction: 0.23,
      forwardMaxPixels: 290,
      pitchMin: 46,
      pitchMax: 60
    });
    assert.equal(
      navigationForwardOffset({
        travelMode: 'drive',
        height: 1200,
        headingUp: true
      }),
      276
    );
    assert.equal(
      navigationForwardOffset({
        travelMode: 'drive',
        height: 2000,
        headingUp: true
      }),
      290
    );
    assert.equal(
      navigationForwardOffset({
        travelMode: 'drive',
        height: 1000,
        headingUp: true,
        speed: 30
      }),
      280
    );

    assert.equal(
      navigationPitch({
        travelMode: 'drive',
        headingUp: true,
        speed: 0
      }),
      46
    );
    assert.equal(
      navigationPitch({
        travelMode: 'drive',
        headingUp: true,
        speed: 25
      }),
      60
    );
    assert.ok(
      navigationPitch({
        travelMode: 'drive',
        headingUp: true,
        speed: 25,
        progress: {
          distanceToManeuverMeters: 30
        }
      }) < 60
    );
  }
);

test(
  'walking and north-up camera keep their restrained behavior',
  () => {
    assert.deepEqual(
      navigationCameraProfile('walk'),
      {
        forwardFraction: 0.16,
        forwardMaxPixels: 140,
        pitchMin: 0,
        pitchMax: 18
      }
    );
    assert.equal(
      navigationForwardOffset({
        travelMode: 'walk',
        height: 1000,
        headingUp: true
      }),
      140
    );
    assert.equal(
      navigationForwardOffset({
        travelMode: 'drive',
        height: 1200,
        headingUp: false
      }),
      0
    );
    assert.equal(
      navigationPitch({
        travelMode: 'walk',
        headingUp: true,
        speed: 1.5
      }),
      0
    );
    assert.equal(
      navigationPitch({
        travelMode: 'drive',
        headingUp: false,
        speed: 20
      }),
      0
    );
  }
);

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
      ['follow', { zoom: 18, headingUp: true, forceCamera: true }]
    );

    compassButton.click();

    assert.equal(controller.isFollowing(), true);
    assert.equal(
      compassButton.attributes.get(
        'aria-pressed'
      ),
      'false'
    );
    assert.deepEqual(
      calls.at(-1),
      ['follow', { zoom: 18, headingUp: false, forceCamera: true }]
    );

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
