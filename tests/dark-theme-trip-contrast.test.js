import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(
  new URL('../src/styles.css', import.meta.url),
  'utf8'
);

test(
  'dark theme keeps readable text on light Trip surfaces',
  () => {
    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop[\s\S]*?color:\s*#18202f/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop-copy strong[\s\S]*?color:\s*#202a3d/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop-copy span[\s\S]*?color:\s*#687487/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop-actions button[\s\S]*?color:\s*#2a354a/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop-actions button\.primary[\s\S]*?color:\s*#(?:fff|ffffff)/i
    );
  }
);

test(
  'dark theme darkens only OSM raster tiles',
  () => {
    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.leaflet-tile-pane\s*\{[^}]*filter\s*:/i
    );

    assert.doesNotMatch(
      css,
      /\.leaflet-map-pane\s*\{[^}]*filter\s*:/i
    );
  }
);

test(
  'dark theme does not leave the Trip day selector on a white surface',
  () => {
    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-schedule-view\s+\.trip-day-control\s*\{[\s\S]*?background:\s*transparent/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-schedule-view\s+\.trip-day-control select\s*\{[\s\S]*?background:\s*var\(--surface-muted\)/i
    );
  }
);

test(
  'dark Trip header uses light text while map stop chips use dark text',
  () => {
    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-workspace-header strong\s*\{[^}]*color:\s*var\(--text\)/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-map-stop\s*\{[^}]*color:\s*#18202f/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-map-stop strong[\s\S]*?color:\s*#202a3d/i
    );
  }
);

test(
  'dark Trip empty selected-stop helper remains readable on its light surface',
  () => {
    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop\s*\{[^}]*color:\s*#18202f[^}]*background:\s*#f5f7fb/i
    );

    assert.match(
      css,
      /html\[data-atlas-theme="dark"\]\s+\.trip-selected-stop > small\s*\{[^}]*color:\s*#687487/i
    );
  }
);
