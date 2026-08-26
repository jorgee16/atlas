import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeRegion } from '../tools/region-builder/normalizer.mjs';
import { AddressStreetProvider } from '../src/search/providers/address-street-provider.js';

function fileResponse(filePath) {
  return fs.readFile(filePath).then(buffer => ({
    ok: true,
    arrayBuffer: async () => buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
  })).catch(() => ({ ok: false, status: 404 }));
}

test('dedicated binary address search resolves house numbers and streets without routing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-address-layer-'));
  const rawGeoJson = path.join(directory, 'raw.geojson');
  const outputDir = path.join(directory, 'output');

  try {
    await fs.writeFile(rawGeoJson, JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'n10',
          geometry: { type: 'Point', coordinates: [-0.1276, 51.5034] },
          properties: {
            'addr:housenumber': '10',
            'addr:street': 'Downing Street',
            'addr:city': 'London',
            'addr:postcode': 'SW1A 2AA'
          }
        },
        {
          type: 'Feature',
          id: 'w1',
          geometry: {
            type: 'LineString',
            coordinates: [[-0.129, 51.503], [-0.128, 51.504]]
          },
          properties: { highway: 'residential', name: 'Downing Street' }
        },
        {
          type: 'Feature',
          id: 'w2',
          geometry: {
            type: 'LineString',
            coordinates: [[-0.128, 51.504], [-0.127, 51.505]]
          },
          properties: { highway: 'residential', name: 'Downing Street' }
        }
      ]
    }), 'utf8');

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

    const provider = new AddressStreetProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'london',
          name: 'London',
          poiUrl: '/regions/london/pois.geojson'
        })
      },
      fetchFn: async url => fileResponse(path.join(outputDir, path.basename(String(url))))
    });

    const exact = await provider.search(
      '10 Downing Street',
      { lat: 51.5034, lon: -0.1276 }
    );
    assert.equal(exact[0].name, '10 Downing Street');
    assert.equal(exact[0].type, 'address');
    assert.equal(exact[0].postcode, 'SW1A 2AA');

    const street = await provider.search(
      'Downing Street',
      { lat: 51.5034, lon: -0.1276 }
    );
    assert.ok(street.some(result => result.type === 'street'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});


test('full street-name relevance beats partial matches regardless of distance', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-address-ranking-'));
  const rawGeoJson = path.join(directory, 'raw.geojson');
  const outputDir = path.join(directory, 'output');

  try {
    await fs.writeFile(rawGeoJson, JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'coimbra-target',
          geometry: {
            type: 'LineString',
            coordinates: [[-8.4257, 40.2033], [-8.4249, 40.2040]]
          },
          properties: {
            highway: 'residential',
            name: 'Rua Professor Albuquerque de Matos',
            'addr:city': 'Coimbra'
          }
        },
        {
          type: 'Feature',
          id: 'lisbon-partial',
          geometry: {
            type: 'LineString',
            coordinates: [[-9.145, 38.72], [-9.144, 38.721]]
          },
          properties: {
            highway: 'residential',
            name: 'Rua Professor Mário de Albuquerque',
            'addr:city': 'Lisboa'
          }
        }
      ]
    }), 'utf8');

    await normalizeRegion({
      rawGeoJson,
      outputDir,
      config: {
        id: 'portugal',
        name: 'Portugal',
        country: 'Portugal',
        bbox: [-9.6, 36.8, -6.0, 42.2],
        categories: {}
      }
    });

    const provider = new AddressStreetProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'portugal',
          name: 'Portugal',
          poiUrl: '/region-packages/portugal/pois.geojson'
        })
      },
      fetchFn: async url => fileResponse(path.join(outputDir, path.basename(String(url))))
    });

    const results = await provider.search(
      'Rua Professor Albuquerque de Matos',
      { lat: 37.09, lon: -8.25 }
    );

    assert.equal(results[0]?.name, 'Rua Professor Albuquerque de Matos');
    assert.equal(results[0]?.city, 'Coimbra');
    assert.ok(results[0]?.distance > 100_000, 'region-wide search must not be proximity-gated');
    assert.ok(!results.some(result => result.name === 'Rua Professor Mário de Albuquerque'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('missing distinctive address token does not broaden into a huge partial union', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-address-missing-token-'));
  const rawGeoJson = path.join(directory, 'raw.geojson');
  const outputDir = path.join(directory, 'output');

  try {
    await fs.writeFile(rawGeoJson, JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'partial',
          geometry: {
            type: 'LineString',
            coordinates: [[-9.145, 38.72], [-9.144, 38.721]]
          },
          properties: {
            highway: 'residential',
            name: 'Rua Professor Mário de Albuquerque'
          }
        }
      ]
    }), 'utf8');

    await normalizeRegion({
      rawGeoJson,
      outputDir,
      config: {
        id: 'portugal',
        name: 'Portugal',
        country: 'Portugal',
        bbox: [-9.6, 36.8, -6.0, 42.2],
        categories: {}
      }
    });

    const requests = [];
    const provider = new AddressStreetProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'portugal',
          name: 'Portugal',
          poiUrl: '/region-packages/portugal/pois.geojson'
        })
      },
      fetchFn: async url => {
        requests.push(path.basename(String(url)));
        return fileResponse(path.join(outputDir, path.basename(String(url))));
      }
    });

    const results = await provider.search(
      'Rua Professor Albuquerque de Matos',
      { lat: 37.09, lon: -8.25 }
    );

    assert.deepEqual(results, []);
    assert.deepEqual(requests, ['address-index.bin']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
