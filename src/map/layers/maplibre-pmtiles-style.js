import { Protocol } from 'pmtiles';

const protocolByMapLibre = new WeakMap();

function ensurePmtilesProtocol(maplibre) {
  if (!maplibre?.addProtocol) {
    throw new TypeError(
      'MapLibre PMTiles support requires maplibre.addProtocol.'
    );
  }

  const existing = protocolByMapLibre.get(maplibre);
  if (existing) return existing;

  const protocol = new Protocol({ metadata: true });
  maplibre.addProtocol('pmtiles', protocol.tile);
  protocolByMapLibre.set(maplibre, protocol);
  return protocol;
}

function pmtilesUrl(url) {
  return url.startsWith('pmtiles://')
    ? url
    : `pmtiles://${url}`;
}

export async function pmtilesArchiveExists(
  url,
  fetchFn = globalThis.fetch?.bind(globalThis)
) {
  if (!url || typeof fetchFn !== 'function') return false;

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-126'
      },
      cache: 'no-store'
    });

    return response.ok;
  } catch (error) {
    console.warn(
      `Offline PMTiles archive is unavailable: ${url}`,
      error
    );
    return false;
  }
}

export async function createMapLibrePmtilesStyle({
  url,
  maplibre,
  fetchFn = globalThis.fetch?.bind(globalThis)
} = {}) {
  if (!url) {
    throw new TypeError(
      'createMapLibrePmtilesStyle requires a PMTiles URL.'
    );
  }

  const exists = await pmtilesArchiveExists(url, fetchFn);
  if (!exists) return null;

  ensurePmtilesProtocol(maplibre);

  return {
    version: 8,
    sources: {
      atlasOffline: {
        type: 'vector',
        url: pmtilesUrl(url),
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'atlas-background',
        type: 'background',
        paint: {
          'background-color': '#eef1e8'
        }
      },
      {
        id: 'atlas-landcover',
        type: 'fill',
        source: 'atlasOffline',
        'source-layer': 'landcover',
        paint: {
          'fill-color': '#eef1e8'
        }
      },
      {
        id: 'atlas-landuse',
        type: 'fill',
        source: 'atlasOffline',
        'source-layer': 'landuse',
        paint: {
          'fill-color': '#ece8df'
        }
      },
      {
        id: 'atlas-park',
        type: 'fill',
        source: 'atlasOffline',
        'source-layer': 'park',
        paint: {
          'fill-color': '#dcebd2'
        }
      },
      {
        id: 'atlas-water',
        type: 'fill',
        source: 'atlasOffline',
        'source-layer': 'water',
        paint: {
          'fill-color': '#b9d9ea'
        }
      },
      {
        id: 'atlas-waterway',
        type: 'line',
        source: 'atlasOffline',
        'source-layer': 'waterway',
        paint: {
          'line-color': '#9bc9df',
          'line-width': 1.5
        }
      },
      {
        id: 'atlas-boundary',
        type: 'line',
        source: 'atlasOffline',
        'source-layer': 'boundary',
        paint: {
          'line-color': '#9c8fa8',
          'line-width': 1,
          'line-opacity': 0.6,
          'line-dasharray': [4, 3]
        }
      },
      {
        id: 'atlas-transportation-casing',
        type: 'line',
        source: 'atlasOffline',
        'source-layer': 'transportation',
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#d7d9dd',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            8, 1.2,
            12, 2.5,
            16, 6
          ]
        }
      },
      {
        id: 'atlas-transportation',
        type: 'line',
        source: 'atlasOffline',
        'source-layer': 'transportation',
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            8, 0.8,
            12, 1.8,
            16, 4.4
          ]
        }
      },
      {
        id: 'atlas-building',
        type: 'fill',
        source: 'atlasOffline',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': '#d8d1c8',
          'fill-outline-color': '#c3bbb1'
        }
      },
      {
        id: 'atlas-aeroway',
        type: 'line',
        source: 'atlasOffline',
        'source-layer': 'aeroway',
        minzoom: 11,
        paint: {
          'line-color': '#c9c9c9',
          'line-width': 2
        }
      }
    ]
  };
}
