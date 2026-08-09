import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('rich rebuild covers London and Portugal and preserves useful POI classes', async () => {
  const [london, portugal, packageJson, script] = await Promise.all([
    fs.readFile(new URL('../tools/region-builder/config/london.json', import.meta.url), 'utf8').then(JSON.parse),
    fs.readFile(new URL('../tools/region-builder/config/portugal.json', import.meta.url), 'utf8').then(JSON.parse),
    fs.readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    fs.readFile(new URL('../tools/region-builder/rebuild-rich-regions.mjs', import.meta.url), 'utf8')
  ]);

  for (const config of [london, portugal]) {
    assert.ok(config.categories.cafe);
    assert.ok(config.categories.restaurant);
    assert.ok(config.categories.pub);
    assert.ok(config.categories.attraction);
    assert.ok(config.categories.stay);
    assert.ok(config.categories.shop);
    assert.ok(config.categories.health);
    assert.ok(config.categories.transport);
    assert.ok(config.categories.service);
  }

  assert.equal(
    portugal.output,
    'public/region-packages/portugal'
  );

  assert.equal(
    packageJson.scripts['regions:rebuild-rich'],
    'node tools/region-builder/rebuild-rich-regions.mjs'
  );

  assert.match(script, /greater-london-latest\.osm\.pbf/);
  assert.match(script, /portugal-latest\.osm\.pbf/);
  assert.match(script, /package-manifest\.mjs/);
  assert.match(script, /region\.version = Math\.max/);
});
