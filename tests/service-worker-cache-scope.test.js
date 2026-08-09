import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../public/sw.js', import.meta.url),
  'utf8'
);

test('service worker matches only its shell cache', () => {
  assert.match(source, /caches\.open\(CACHE\)/);
  assert.match(source, /SHELL\.includes\(url\.pathname\)/);
  assert.doesNotMatch(source, /caches\.match\(event\.request\)/);
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
