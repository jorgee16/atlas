import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesUrl = new URL(
  '../src/styles.css',
  import.meta.url
);

test(
  'selected-point actions use a full-width vertical layout',
  async () => {
    const css = await readFile(
      stylesUrl,
      'utf8'
    );

    const actionsRule = css.match(
      /\.map-selection-actions\s*\{(?<body>[^}]*)\}/
    );

    assert.ok(
      actionsRule,
      'map-selection-actions rule is missing'
    );
    assert.match(
      actionsRule.groups.body,
      /flex-direction:\s*column/
    );
    assert.doesNotMatch(
      actionsRule.groups.body,
      /grid-template-columns/
    );

    const buttonRule = css.match(
      /\.map-selection-action\s*\{(?<body>[^}]*)\}/
    );

    assert.ok(
      buttonRule,
      'map-selection-action rule is missing'
    );
    assert.match(
      buttonRule.groups.body,
      /width:\s*100%/
    );
    assert.match(
      css,
      /map-selection-leaflet-popup-v2/
    );
  }
);
