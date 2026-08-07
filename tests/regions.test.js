import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  RegionCatalog
} from '../src/regions/region-catalog.js';

import {
  RegionRepository
} from '../src/search/region-repository.js';

const cataloguePath =
  new URL(
    '../public/regions/catalog.json',
    import.meta.url
  );

async function loadCatalogue() {
  return JSON.parse(
    await fs.readFile(
      cataloguePath,
      'utf8'
    )
  );
}

test(
  'Portugal replaces Lisbon and covers all three geographic areas',
  async () => {
    const document = await loadCatalogue();

    assert.equal(
      document.regions.some(
        region => region.id === 'lisbon'
      ),
      false
    );

    const catalog = new RegionCatalog({
      url: '/regions/catalog.json',
      fetchFn: async () => ({
        ok: true,
        json: async () => document
      })
    });

    const positions = [
      { lat: 38.72, lon: -9.14 },
      { lat: 32.65, lon: -16.91 },
      { lat: 37.74, lon: -25.67 }
    ];

    for (const position of positions) {
      assert.equal(
        (await catalog.findByPosition(position))?.id,
        'portugal'
      );
    }

    assert.equal(
      await catalog.findByPosition({
        lat: 37.5,
        lon: -20
      }),
      null
    );
  }
);

test(
  'repository derives searchable regions from the authoritative catalogue',
  async () => {
    const document = await loadCatalogue();

    const repository = new RegionRepository({
      catalog: {
        list: async () => document.regions
      },
      installStore: {
        load: () => []
      }
    });

    assert.deepEqual(
      (await repository.list())
        .map(region => region.id),
      ['london', 'portugal']
    );
  }
);

test(
  'bundled spatial indexes contain every POI exactly once',
  async () => {
    const packages = [
      '../public/regions/london',
      '../public/region-packages/portugal'
    ];

    for (const relativePath of packages) {
      const base = new URL(
        `${relativePath}/`,
        import.meta.url
      );

      const [poiDocument, index] =
        await Promise.all([
          fs.readFile(
            new URL('pois.geojson', base),
            'utf8'
          ).then(JSON.parse),
          fs.readFile(
            new URL('poi-index.json', base),
            'utf8'
          ).then(JSON.parse)
        ]);

      const seen =
        new Uint8Array(
          poiDocument.features.length
        );

      for (const indexes of Object.values(index.cells)) {
        for (const featureIndex of indexes) {
          assert.ok(
            Number.isInteger(featureIndex) &&
            featureIndex >= 0 &&
            featureIndex < seen.length
          );

          seen[featureIndex] += 1;
        }
      }

      assert.equal(
        seen.every(count => count === 1),
        true
      );
    }
  }
);
