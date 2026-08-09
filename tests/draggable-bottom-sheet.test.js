import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DraggableBottomSheet
} from '../src/ui/draggable-bottom-sheet.js';

test(
  'mobile keyboard resize does not move the sheet while its search input is focused',
  () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousAnimationFrame =
      globalThis.requestAnimationFrame;
    const listeners = new Map();
    const focusedInput = {
      matches: selector => selector.includes('input')
    };

    const documentRef = {
      activeElement: focusedInput
    };

    globalThis.window = {
      innerHeight: 800,
      addEventListener: (name, callback) =>
        listeners.set(name, callback)
    };
    globalThis.document = documentRef;
    globalThis.requestAnimationFrame = callback => callback();

    const sheet = {
      ownerDocument: documentRef,
      dataset: {},
      style: {},
      classList: {
        toggle() {},
        remove() {},
        add() {}
      },
      contains: element => element === focusedInput
    };

    const handle = {
      addEventListener() {}
    };

    try {
      const draggable = new DraggableBottomSheet({
        sheet,
        handle,
        initialSnap: 'half'
      });

      assert.equal(sheet.style.transform, 'translateY(400px)');

      globalThis.window.innerHeight = 500;
      listeners.get('resize')();

      assert.equal(sheet.style.transform, 'translateY(400px)');
      assert.equal(draggable.viewportHeight, 800);

      documentRef.activeElement = null;
      listeners.get('resize')();

      assert.equal(sheet.style.transform, 'translateY(250px)');
      assert.equal(draggable.viewportHeight, 500);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.requestAnimationFrame =
        previousAnimationFrame;
    }
  }
);
