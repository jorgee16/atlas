import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MapSelectionFeature
} from '../src/features/map-selection/map-selection-feature.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.dataset = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  click() {
    return this.listeners.get('click')?.({
      stopPropagation() {}
    });
  }
}

const documentRef = {
  createElement: tagName =>
    new FakeElement(tagName)
};

test(
  'selected map point exposes navigate, bookmark and nearby actions',
  async () => {
    const calls = [];
    let shownPin = null;
    let clearedPins = 0;
    let closedPopups = 0;

    const feature =
      new MapSelectionFeature({
        map: {
          showSelectionPin:
            (lat, lon, content) => {
              shownPin = {
                lat,
                lon,
                content
              };
            },
          clearSelectionPin: () => {
            clearedPins += 1;
          },
          closeSelectionPopup: () => {
            closedPopups += 1;
          }
        },
        status: () => {},
        onNavigate: point =>
          calls.push(['navigate', point]),
        onBookmark: point =>
          calls.push(['bookmark', point]),
        onSearchNearby: point =>
          calls.push(['nearby', point]),
        documentRef
      });

    const point = feature.select({
      lat: 40.2033,
      lon: -8.4103
    });

    assert.deepEqual(point, {
      name: 'Selected point',
      lat: 40.2033,
      lon: -8.4103
    });

    assert.equal(shownPin.lat, point.lat);
    assert.equal(shownPin.lon, point.lon);

    const actionContainer =
      shownPin.content.children[2];

    assert.equal(
      shownPin.content.dataset.layout,
      'stacked-actions-v2'
    );

    const buttons =
      actionContainer.children;

    assert.deepEqual(
      buttons.map(button => button.textContent),
      [
        'Navigate',
        'Bookmark',
        'Search nearby'
      ]
    );

    assert.deepEqual(
      buttons.map(button => button.className),
      [
        'map-selection-action map-selection-action--navigate',
        'map-selection-action map-selection-action--bookmark',
        'map-selection-action map-selection-action--nearby'
      ]
    );

    await buttons[0].click();
    await buttons[1].click();
    await buttons[2].click();

    assert.deepEqual(
      calls.map(([action]) => action),
      ['navigate', 'bookmark', 'nearby']
    );

    assert.equal(clearedPins, 1);
    assert.equal(closedPopups, 2);
  }
);

test(
  'failed navigation leaves the selected-point popup open',
  async () => {
    let closedPopups = 0;
    let shownContent = null;

    const feature =
      new MapSelectionFeature({
        map: {
          showSelectionPin:
            (lat, lon, content) => {
              shownContent = content;
            },
          clearSelectionPin() {},
          closeSelectionPopup: () => {
            closedPopups += 1;
          }
        },
        onNavigate: () => false,
        documentRef
      });

    feature.select({
      lat: 40.2033,
      lon: -8.4103
    });

    await shownContent
      .children[2]
      .children[0]
      .click();

    assert.equal(closedPopups, 0);
  }
);

test(
  'map point selection rejects invalid coordinates',
  () => {
    const feature =
      new MapSelectionFeature({
        map: {
          showSelectionPin() {},
          clearSelectionPin() {}
        },
        documentRef
      });

    assert.throws(
      () => feature.select({
        lat: Number.NaN,
        lon: -8.4
      }),
      /requires lat and lon/
    );
  }
);
