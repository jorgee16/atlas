import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../public/sw.js', import.meta.url),
  'utf8'
);

test('service worker owns only the application shell and excludes region assets', () => {
  assert.match(source, /caches\.open\(CACHE\)/);

  assert.match(
    source,
    /url\.pathname\.startsWith\('\/region-packages\/'\)/
  );

  assert.match(
    source,
    /url\.pathname\.startsWith\('\/regions\/'\)/
  );

  assert.match(
    source,
    /url\.pathname\.startsWith\('\/assets\/'\)/
  );

  assert.match(
    source,
    /event\.request\.mode === 'navigate'/
  );

  assert.match(
    source,
    /cache\.match\('\/index\.html'\)/
  );

  assert.doesNotMatch(
    source,
    /caches\.match\(event\.request\)/
  );
});

test('application explicitly updates the corrected service worker', async () => {
  const mainSource = await readFile(
    new URL('../src/main.js', import.meta.url),
    'utf8'
  );

  assert.match(mainSource, /\.register\('\/sw\.js'/);
  assert.match(mainSource, /updateViaCache: 'none'/);
  assert.match(mainSource, /registration\.update\(\)/);
});

test('service worker retires the legacy global shell cache', () => {
  assert.match(source, /name\.startsWith\('roam-shell-'\)/);
  assert.match(source, /caches\.delete\(name\)/);
});
