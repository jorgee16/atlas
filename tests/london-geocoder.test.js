import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  LocalRegionProvider
} from '../src/search/providers/local-region-provider.js';

function response(value) {
  return {
    ok: true,
    json: async () => value
  };
}

test(
  'London and Portugal remain present in the authoritative region catalogue',
  async () => {
    const catalogue = JSON.parse(
      await fs.readFile(
        new URL(
          '../public/regions/catalog.json',
          import.meta.url
        ),
        'utf8'
      )
    );

    const regions = Object.fromEntries(
      catalogue.regions.map(region => [
        region.id,
        region
      ])
    );

    assert.ok(regions.london);
    assert.ok(regions.portugal);
    assert.ok(Number.isInteger(regions.london.version));
    assert.ok(Number.isInteger(regions.portugal.version));
    assert.ok(regions.london.version >= 4);
    assert.ok(regions.portugal.version >= 4);
  }
);

test(
  'London geographic records stay searchable but never appear in Nearby',
  async () => {
    const features = [
      {
        id: 'camden',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.142, 51.539]
        },
        properties: {
          name: 'London Borough of Camden',
          type: 'administrative',
          boundary: 'administrative',
          admin_level: '8',
          search_only: true
        }
      },
      {
        id: 'soho',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.135, 51.513]
        },
        properties: {
          name: 'Soho',
          type: 'locality',
          place: 'suburb'
        }
      },
      {
        id: 'cafe',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.136, 51.514]
        },
        properties: {
          name: 'Soho Coffee House',
          type: 'cafe',
          amenity: 'cafe'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'london',
          name: 'London',
          poiUrl: '/regions/london/pois.geojson',
          indexUrl: '/regions/london/poi-index.json'
        })
      },
      fetchFn: async url =>
        url.includes('poi-index')
          ? response({
              kind: 'uniform-grid',
              cellSizeDegrees: 1,
              cells: { '-1:51': [0, 1, 2] }
            })
          : response({ features })
    });

    const anchor = {
      lat: 51.514,
      lon: -0.136
    };

    const camden = await provider.searchByName(
      'Camden',
      anchor
    );

    const soho = await provider.searchByName(
      'Soho',
      anchor
    );

    assert.equal(camden[0].id, 'camden');
    assert.equal(soho[0].id, 'soho');

    const nearby = await provider.search(anchor, 5000);

    assert.deepEqual(
      nearby.map(place => place.id),
      ['cafe']
    );
  }
);
