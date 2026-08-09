import test from 'node:test';
import assert from 'node:assert/strict';

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
  'offline destination search is accent-insensitive and ranked near the selected start',
  async () => {
    const features = [
      {
        id: 'far',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.2, 38.8]
        },
        properties: {
          name: 'Praça Central',
          amenity: 'square'
        }
      },
      {
        id: 'near',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.14, 38.71]
        },
        properties: {
          name: 'Praça Central',
          amenity: 'square'
        }
      },
      {
        id: 'other',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.13, 38.72]
        },
        properties: {
          name: 'Mercado Municipal',
          amenity: 'museum',
          'addr:street': 'Rua Augusta',
          'addr:housenumber': '24',
          'addr:city': 'Lisboa'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'portugal',
          name: 'Portugal',
          poiUrl: '/pois.geojson',
          indexUrl: '/poi-index.json'
        })
      },
      fetchFn: async url =>
        url.includes('poi-index')
          ? response({
              kind: 'uniform-grid',
              cellSizeDegrees: 0.01,
              cells: {}
            })
          : response({ features })
    });

    const results = await provider.searchByName(
      'praca central',
      { lat: 38.71, lon: -9.14 }
    );

    assert.deepEqual(
      results.map(place => place.id),
      ['near', 'far']
    );

    assert.equal(results[0].regionId, 'portugal');

    const addressResults = await provider.searchByName(
      'rua augusta 24',
      { lat: 38.71, lon: -9.14 }
    );

    assert.equal(addressResults[0].id, 'other');
    assert.equal(addressResults[0].address, '24 Rua Augusta');
    assert.equal(addressResults[0].city, 'Lisboa');

    const typoResults = await provider.searchByName(
      'musem',
      { lat: 38.71, lon: -9.14 }
    );

    assert.equal(typoResults[0].id, 'other');
  }
);

test(
  'offline destination search includes geographic names but Nearby hides them',
  async () => {
    const features = [
      {
        id: 'alcabideche',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.409, 38.734]
        },
        properties: {
          name: 'Alcabideche',
          type: 'locality',
          amenity: 'place',
          place: 'town',
          search_only: true,
          municipality: 'Cascais'
        }
      },
      {
        id: 'cafe',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.408, 38.734]
        },
        properties: {
          name: 'Café Central',
          amenity: 'cafe',
          type: 'cafe'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'portugal',
          name: 'Portugal',
          poiUrl: '/pois.geojson',
          indexUrl: '/poi-index.json'
        })
      },
      fetchFn: async url =>
        url.includes('poi-index')
          ? response({
              kind: 'uniform-grid',
              cellSizeDegrees: 1,
              cells: { '-10:38': [0, 1] }
            })
          : response({ features })
    });

    const anchor = {
      lat: 38.734,
      lon: -9.409
    };

    const matches = await provider.searchByName(
      'Alcabideche',
      anchor
    );

    assert.equal(matches[0].name, 'Alcabideche');
    assert.equal(matches[0].place, 'town');
    assert.equal(matches[0].city, 'Cascais');

    const nearby = await provider.search(anchor, 1000);
    assert.deepEqual(
      nearby.map(place => place.id),
      ['cafe']
    );
  }
);

test(
  'destination search collapses duplicate OSM representations but keeps distinct same-name places',
  async () => {
    const features = [
      {
        id: 'way/545718142',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.409, 38.734]
        },
        properties: {
          name: 'Alcabideche',
          type: 'locality',
          place: 'village',
          search_only: true,
          municipality: 'Cascais'
        }
      },
      {
        id: 'relation/alcabideche-parish',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.402, 38.741]
        },
        properties: {
          name: 'Alcabideche',
          type: 'parish',
          boundary: 'administrative',
          search_only: true,
          municipality: 'Cascais'
        }
      },
      {
        id: 'node/other-alcabideche',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-8.5, 39.4]
        },
        properties: {
          name: 'Alcabideche',
          type: 'locality',
          place: 'village',
          search_only: true,
          municipality: 'Another municipality'
        }
      },
      {
        id: 'node/cafe-central',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.41, 38.735]
        },
        properties: {
          name: 'Café Central',
          type: 'cafe',
          amenity: 'cafe'
        }
      },
      {
        id: 'way/cafe-central',
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-9.4099, 38.7351]
        },
        properties: {
          name: 'Café Central',
          type: 'cafe',
          amenity: 'cafe'
        }
      }
    ];

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'portugal',
          name: 'Portugal',
          poiUrl: '/pois.geojson',
          indexUrl: '/poi-index.json'
        })
      },
      fetchFn: async url =>
        url.includes('poi-index')
          ? response({
              kind: 'uniform-grid',
              cellSizeDegrees: 1,
              cells: {}
            })
          : response({ features })
    });

    const anchor = { lat: 38.734, lon: -9.409 };
    const geographicResults = await provider.searchByName(
      'Alcabideche',
      anchor
    );

    assert.deepEqual(
      geographicResults.map(place => place.id),
      ['way/545718142', 'node/other-alcabideche']
    );

    const cafeResults = await provider.searchByName(
      'cafe central',
      anchor
    );

    assert.deepEqual(
      cafeResults.map(place => place.id),
      ['node/cafe-central']
    );
  }
);

test(
  'broad destination searches stay bounded and accept non-string OSM names',
  { timeout: 2_000 },
  async () => {
    const features = Array.from(
      { length: 6_000 },
      (_, index) => ({
        id: `cafe-${index}`,
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            -9 + index * 0.00001,
            38.7
          ]
        },
        properties: {
          name: index === 0
            ? 12345
            : `Cafe ${index}`,
          amenity: 'cafe',
          type: 'cafe',
          alt_name: index === 0
            ? 'Cafe 12345'
            : undefined
        }
      })
    );

    const provider = new LocalRegionProvider({
      regionRepository: {
        findByPosition: async () => ({
          id: 'portugal',
          name: 'Portugal',
          poiUrl: '/pois.geojson',
          indexUrl: '/poi-index.json'
        })
      },
      fetchFn: async url =>
        url.includes('poi-index')
          ? response({
              kind: 'uniform-grid',
              cellSizeDegrees: 1,
              cells: {}
            })
          : response({ features })
    });

    const results = await provider.searchByName(
      'cafe',
      { lat: 38.7, lon: -9 },
      { limit: 12 }
    );

    assert.equal(results.length, 12);
    assert.equal(
      results.some(place => typeof place.name !== 'string'),
      false
    );
  }
);
