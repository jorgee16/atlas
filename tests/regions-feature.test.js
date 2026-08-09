import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('offline regions exposes a library-first flow with a map-based add-region selector', async () => {
  const source = await readFile(
    new URL('../src/features/regions/regions-feature.js', import.meta.url),
    'utf8'
  );
  const shell = await readFile(
    new URL('../src/ui/app-shell.js', import.meta.url),
    'utf8'
  );

  assert.match(shell, /id="regionsOverlay"/);
  assert.match(source, /data-region-action="add-region"/);
  assert.match(source, /data-region-action="select-region"/);
  assert.match(source, /data-region-action="back-library"/);
  assert.match(source, /this\.map\.focus\(center\.lat, center\.lon, 7\)/);
  assert.match(source, /this\.libraryScrollTop = this\.listElement\.scrollTop/);
  assert.match(source, /Installed library/);
});
