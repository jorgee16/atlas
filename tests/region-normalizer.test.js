import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeRegion
} from '../tools/region-builder/normalizer.mjs';

test(
  'region builder packages named OSM localities as search-only entries',
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'atlas-geocoder-')
    );

    const rawGeoJson = path.join(directory, 'raw.geojson');
    const outputDir = path.join(directory, 'output');

    try {
      await fs.writeFile(
        rawGeoJson,
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'n123',
            geometry: {
              type: 'Point',
              coordinates: [-9.409, 38.734]
            },
            properties: {
              name: 'Alcabideche',
              place: 'town',
              municipality: 'Cascais',
              'name:pt': 'Alcabideche'
            }
          }]
        }),
        'utf8'
      );

      await normalizeRegion({
        rawGeoJson,
        outputDir,
        config: {
          id: 'portugal',
          name: 'Portugal',
          country: 'Portugal',
          bbox: [-9.6, 36.8, -6.1, 42.2],
          categories: {}
        }
      });

      const document = JSON.parse(
        await fs.readFile(
          path.join(outputDir, 'pois.geojson'),
          'utf8'
        )
      );

      assert.equal(document.features.length, 1);
      assert.deepEqual(
        document.features[0].properties,
        {
          name: 'Alcabideche',
          type: 'locality',
          amenity: 'place',
          place: 'town',
          search_only: true,
          municipality: 'Cascais',
          'name:pt': 'Alcabideche',
          osm_id: 'n123'
        }
      );
    } finally {
      await fs.rm(directory, {
        recursive: true,
        force: true
      });
    }
  }
);

test(
  'region builder packages exact OSM addresses as search-only geocoder entries',
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'atlas-address-geocoder-')
    );

    const rawGeoJson = path.join(directory, 'raw.geojson');
    const outputDir = path.join(directory, 'output');

    try {
      await fs.writeFile(
        rawGeoJson,
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'n10',
            geometry: {
              type: 'Point',
              coordinates: [-0.1276, 51.5034]
            },
            properties: {
              'addr:housenumber': '10',
              'addr:street': 'Downing Street',
              'addr:city': 'London',
              'addr:postcode': 'SW1A 2AA'
            }
          }]
        }),
        'utf8'
      );

      await normalizeRegion({
        rawGeoJson,
        outputDir,
        config: {
          id: 'london',
          name: 'London',
          country: 'United Kingdom',
          bbox: [-0.55, 51.25, 0.35, 51.75],
          categories: {}
        }
      });

      const document = JSON.parse(
        await fs.readFile(path.join(outputDir, 'pois.geojson'), 'utf8')
      );

      assert.equal(document.features.length, 1);
      assert.deepEqual(
        document.features[0].properties,
        {
          name: '10 Downing Street',
          type: 'address',
          amenity: 'address',
          search_only: true,
          'addr:housenumber': '10',
          'addr:street': 'Downing Street',
          'addr:city': 'London',
          'addr:postcode': 'SW1A 2AA',
          osm_id: 'n10'
        }
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);
