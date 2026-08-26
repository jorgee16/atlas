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
      await fs.mkdir(outputDir, { recursive: true });
      await Promise.all([
        fs.writeFile(
          path.join(outputDir, 'search-index.json'),
          '{\"legacy\":true}',
          'utf8'
        ),
        fs.writeFile(
          path.join(outputDir, 'search-records.json'),
          '{\"legacy\":true}',
          'utf8'
        )
      ]);

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
      await assert.rejects(
        fs.access(path.join(outputDir, 'search-index.json')),
        { code: 'ENOENT' }
      );
      await assert.rejects(
        fs.access(path.join(outputDir, 'search-records.json')),
        { code: 'ENOENT' }
      );

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
  'region builder keeps exact OSM addresses out of POIs and writes dedicated address binaries',
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

      assert.equal(document.features.length, 0);
      const addressIndex = await fs.stat(path.join(outputDir, 'address-index.bin'));
      const addressRecords = await fs.stat(path.join(outputDir, 'address-records.bin'));
      assert.ok(addressIndex.size > 0);
      assert.ok(addressRecords.size > 0);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);

test(
  'binary destination search assets resolve results without loading POI GeoJSON',
  async () => {
    const { LocalRegionProvider } = await import(
      '../src/search/providers/local-region-provider.js'
    );
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'atlas-binary-search-')
    );
    const rawGeoJson = path.join(directory, 'raw.geojson');
    const outputDir = path.join(directory, 'output');
    const requested = [];

    try {
      await fs.writeFile(
        rawGeoJson,
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'cafe-1',
            geometry: {
              type: 'Point',
              coordinates: [-9.14, 38.71]
            },
            properties: {
              name: 'Cafe Central',
              amenity: 'cafe',
              'addr:city': 'Lisboa'
            }
          }]
        }),
        'utf8'
      );

      const metadata = await normalizeRegion({
        rawGeoJson,
        outputDir,
        config: {
          id: 'portugal',
          name: 'Portugal',
          country: 'Portugal',
          bbox: [-9.6, 36.8, -6.1, 42.2],
          categories: {
            cafe: [{ key: 'amenity', values: ['cafe'] }]
          }
        }
      });

      const provider = new LocalRegionProvider({
        regionRepository: {
          findByPosition: async () => ({
            ...metadata,
            poiUrl: '/pois.geojson',
            searchUrl: '/search-index.bin',
            searchRecordsUrl: '/search-records.bin'
          })
        },
        fetchFn: async url => {
          requested.push(url);
          const filePath = path.join(outputDir, path.basename(url));
          try {
            const bytes = await fs.readFile(filePath);
            return {
              ok: true,
              status: 200,
              arrayBuffer: async () => bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
              ),
              json: async () => JSON.parse(bytes.toString('utf8'))
            };
          } catch {
            return { ok: false, status: 404 };
          }
        }
      });

      const results = await provider.searchByName(
        'cafe central',
        { lat: 38.71, lon: -9.14 }
      );

      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'Cafe Central');
      assert.equal(results[0].city, 'Lisboa');
      assert.equal(
        requested.some(url => url.includes('pois.geojson')),
        false
      );
      assert.equal(
        requested.some(url => url.includes('search-index.json')),
        false
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);
