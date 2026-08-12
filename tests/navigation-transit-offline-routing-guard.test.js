import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL(
    '../src/features/navigation/navigation-feature.js',
    import.meta.url
  ),
  'utf8'
);

test(
  'active transit mode never enters the offline route calculator',
  () => {
    const start = source.indexOf(
      'async #calculateRoute({'
    );

    assert.notEqual(
      start,
      -1,
      '#calculateRoute must exist'
    );

    const section = source.slice(
      start,
      start + 1600
    );

    assert.match(
      section,
      /if\s*\(\s*this\.travelMode\s*===\s*['"]transit['"]\s*\)\s*\{\s*return false;\s*\}/
    );

    assert.match(
      section,
      /profile:\s*this\.travelMode/
    );

    assert.ok(
      section.indexOf(
        "this.travelMode === 'transit'"
      ) <
      section.indexOf(
        'this.routingService.route('
      ),
      'transit guard must run before offline routing'
    );
  }
);
