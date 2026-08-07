import * as protomapsL from 'protomaps-leaflet';

const paintRules = [
  {
    dataLayer: 'landcover',
    symbolizer: new protomapsL.PolygonSymbolizer({
      fill: '#eef1e8'
    })
  },
  {
    dataLayer: 'landuse',
    symbolizer: new protomapsL.PolygonSymbolizer({
      fill: '#ece8df'
    })
  },
  {
    dataLayer: 'park',
    symbolizer: new protomapsL.PolygonSymbolizer({
      fill: '#dcebd2'
    })
  },
  {
    dataLayer: 'water',
    symbolizer: new protomapsL.PolygonSymbolizer({
      fill: '#b9d9ea'
    })
  },
  {
    dataLayer: 'waterway',
    symbolizer: new protomapsL.LineSymbolizer({
      color: '#9bc9df',
      width: 1.5
    })
  },
  {
    dataLayer: 'building',
    minzoom: 13,
    symbolizer: new protomapsL.PolygonSymbolizer({
      fill: '#d8d1c8',
      stroke: '#c3bbb1',
      width: 0.5
    })
  },
  {
    dataLayer: 'boundary',
    symbolizer: new protomapsL.LineSymbolizer({
      color: '#9c8fa8',
      width: 1,
      opacity: 0.6,
      dash: [4, 3]
    })
  },
  {
    dataLayer: 'transportation',
    symbolizer: new protomapsL.LineSymbolizer({
      color: '#ffffff',
      width: zoom => {
        if (zoom >= 16) return 4;
        if (zoom >= 14) return 3;
        if (zoom >= 12) return 2;
        return 1;
      },
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round'
    })
  },
  {
    dataLayer: 'aeroway',
    minzoom: 11,
    symbolizer: new protomapsL.LineSymbolizer({
      color: '#c9c9c9',
      width: 2
    })
  }
];

const labelRules = [];

export function createPmtilesVectorLayer({ url }) {
  if (!url) {
    throw new TypeError(
      'createPmtilesVectorLayer requires a PMTiles URL.'
    );
  }

  return protomapsL.leafletLayer({
    url,
    paintRules,
    labelRules,
    attribution: '© OpenStreetMap contributors'
  });
}

export async function pmtilesArchiveExists(
  url,
  fetchFn = globalThis.fetch.bind(globalThis)
) {
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
