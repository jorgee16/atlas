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

test(
  'London search strongly prefers exact structured addresses',
  async () => {
    const features = [
      {
        id: 'poi',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.126, 51.503]
        },
        properties: {
          name: 'Downing Street Cafe',
          amenity: 'cafe'
        }
      },
      {
        id: 'address',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.1276, 51.5034]
        },
        properties: {
          name: '12 Downing Street',
          'addr:housenumber': '12',
          'addr:street': 'Downing Street',
          'addr:postcode': 'SW1A 2AD'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'london',
          name: 'London',
          poiUrl: '/london/pois.geojson',
          indexUrl: '/london/poi-index.json'
        })
      },
      fetchFn: async url => {
        if (String(url).includes('poi-index.json')) {
          return response({
            kind: 'uniform-grid',
            cellSizeDegrees: 0.01,
            cells: {}
          });
        }

        return response({
          type: 'FeatureCollection',
          features
        });
      }
    });

    const results = await provider.searchByName(
      '12 Downing Street',
      { lat: 51.503, lon: -0.127 },
      { limit: 10 }
    );

    assert.equal(
      results[0].name,
      '12 Downing Street'
    );
  }
);

test(
  'London search recognizes compact and spaced UK postcodes',
  async () => {
    const features = [
      {
        id: 'sw7',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.176, 51.497]
        },
        properties: {
          name: 'Example Address',
          'addr:housenumber': '10',
          'addr:street': 'Exhibition Road',
          'addr:postcode': 'SW7 2DD'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'london',
          name: 'London',
          poiUrl: '/london/pois.geojson',
          indexUrl: '/london/poi-index.json'
        })
      },
      fetchFn: async url => {
        if (String(url).includes('poi-index.json')) {
          return response({
            kind: 'uniform-grid',
            cellSizeDegrees: 0.01,
            cells: {}
          });
        }

        return response({
          type: 'FeatureCollection',
          features
        });
      }
    });

    for (const query of [
      'SW7 2DD',
      'sw7 2dd',
      'SW72DD'
    ]) {
      const results =
        await provider.searchByName(
          query,
          { lat: 51.497, lon: -0.176 },
          { limit: 10 }
        );

      assert.equal(
        results[0].name,
        'Example Address'
      );
    }
  }
);

test(
  'same-name London destinations remain distinct when their locations differ',
  async () => {
    const features = [
      {
        id: 'victoria-a',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.1439, 51.4965]
        },
        properties: {
          name: 'Victoria',
          'addr:postcode': 'SW1V 1JT',
          place: 'locality'
        }
      },
      {
        id: 'victoria-b',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.1020, 51.5140]
        },
        properties: {
          name: 'Victoria',
          'addr:postcode': 'EC4M 7DX',
          place: 'locality'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'london',
          name: 'London',
          poiUrl: '/london/pois.geojson',
          indexUrl: '/london/poi-index.json'
        })
      },

      fetchFn: async url => {
        if (
          String(url).includes('poi-index.json')
        ) {
          return response({
            kind: 'uniform-grid',
            cellSizeDegrees: 0.01,
            cells: {}
          });
        }

        return response({
          type: 'FeatureCollection',
          features
        });
      }
    });

    const results =
      await provider.searchByName(
        'Victoria',
        { lat: 51.50, lon: -0.13 },
        { limit: 10 }
      );

    assert.equal(results.length, 2);

    assert.deepEqual(
      new Set(results.map(result => result.id)),
      new Set([
        'victoria-a',
        'victoria-b'
      ])
    );
  }
);
