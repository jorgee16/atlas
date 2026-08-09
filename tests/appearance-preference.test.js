import test from 'node:test';
import assert from 'node:assert/strict';
import { AppearancePreference } from '../src/settings/appearance-preference.js';

test('appearance preference persists and resolves system theme', () => {
  const values = new Map();
  const dataset = {};
  const style = {};
  const preference = new AppearancePreference({
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    documentRef: { documentElement: { dataset, style } },
    matchMediaRef: () => ({
      matches: true,
      addEventListener: () => {}
    })
  });

  assert.equal(preference.getMode(), 'system');
  assert.equal(dataset.atlasTheme, 'dark');
  assert.equal(preference.setMode('light'), true);
  assert.equal(values.get('atlas.appearance'), 'light');
  assert.equal(dataset.atlasTheme, 'light');
  assert.equal(style.colorScheme, 'light');
});
