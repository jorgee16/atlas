import assert from 'node:assert/strict';
import test from 'node:test';

import { ScreenWakeLock } from '../src/platform/screen-wake-lock.js';

function documentStub() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name) { listeners.get(name)?.(); }
  };
}

test('active navigation acquires and stopping releases the screen wake lock', async () => {
  const documentRef = documentStub();
  let releases = 0;
  const sentinel = {
    addEventListener() {},
    async release() { releases += 1; }
  };
  const navigatorRef = {
    wakeLock: {
      async request(type) {
        assert.equal(type, 'screen');
        return sentinel;
      }
    }
  };

  const wakeLock = new ScreenWakeLock({ navigatorRef, documentRef });
  assert.equal(await wakeLock.setActive(true), true);
  await wakeLock.setActive(false);
  assert.equal(releases, 1);
  await wakeLock.destroy();
});

test('wake lock is reacquired when active navigation becomes visible again', async () => {
  const documentRef = documentStub();
  let requests = 0;
  const navigatorRef = {
    wakeLock: {
      async request() {
        requests += 1;
        return { addEventListener() {}, async release() {} };
      }
    }
  };

  const wakeLock = new ScreenWakeLock({ navigatorRef, documentRef });
  await wakeLock.setActive(true);
  assert.equal(requests, 1);

  // Simulate Android releasing the current lock while Atlas is backgrounded.
  wakeLock.sentinel = null;
  documentRef.visibilityState = 'visible';
  documentRef.dispatch('visibilitychange');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);

  await wakeLock.destroy();
});
