const VECTOR_SOURCE = 'atlas-vector';
const TILE_URL = 'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}';
const GLYPHS_URL = 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf';
const FONT_REGULAR = ['noto_sans_regular'];
const FONT_SEMIBOLD = ['noto_sans_semibold'];

const roadWidth = [
  'interpolate', ['linear'], ['zoom'],
  5, 0.35,
  9, 0.8,
  12, 1.7,
  14, 3.4,
  16, 6.4,
  18, 11
];

const roadCasingWidth = [
  'interpolate', ['linear'], ['zoom'],
  5, 0.7,
  9, 1.3,
  12, 2.5,
  14, 4.6,
  16, 7.8,
  18, 13
];

const minorRoadWidth = [
  'interpolate', ['linear'], ['zoom'],
  12, 0.7,
  14, 1.8,
  16, 3.6,
  18, 6.5
];

const labelSize = [
  'interpolate', ['linear'], ['zoom'],
  11, 10,
  14, 12,
  17, 14
];

export function createAtlasMapLibreStyle() {
  return {
    version: 8,
    name: 'Atlas Navigation',
    glyphs: GLYPHS_URL,
    sources: {
      [VECTOR_SOURCE]: {
        type: 'vector',
        tiles: [TILE_URL],
        minzoom: 0,
        maxzoom: 14,
        attribution:
          '© OpenStreetMap contributors · © ESA WorldCover · VersaTiles'
      }
    },
    layers: [
      {
        id: 'atlas-background',
        type: 'background',
        paint: { 'background-color': '#f4f3ee' }
      },
      {
        id: 'atlas-ocean',
        type: 'fill',
        source: VECTOR_SOURCE,
        'source-layer': 'ocean',
        paint: { 'fill-color': '#b9dce9' }
      },
      {
        id: 'atlas-land',
        type: 'fill',
        source: VECTOR_SOURCE,
        'source-layer': 'land',
        paint: {
          'fill-color': [
            'match', ['get', 'kind'],
            'forest', '#dce9d6',
            'wood', '#dce9d6',
            'grass', '#e6eddc',
            'grassland', '#e6eddc',
            'meadow', '#e8efdf',
            'farmland', '#eee9d9',
            'orchard', '#e3ead8',
            'vineyard', '#e3ead8',
            'residential', '#f0efea',
            'industrial', '#ebe8e3',
            'commercial', '#efebe6',
            'cemetery', '#dfe8d8',
            '#ecece6'
          ],
          'fill-opacity': 0.92
        }
      },
      {
        id: 'atlas-water',
        type: 'fill',
        source: VECTOR_SOURCE,
        'source-layer': 'water_polygons',
        paint: { 'fill-color': '#b9dce9' }
      },
      {
        id: 'atlas-sites',
        type: 'fill',
        source: VECTOR_SOURCE,
        'source-layer': 'sites',
        minzoom: 13,
        paint: {
          'fill-color': [
            'match', ['get', 'kind'],
            'parking', '#e7e7e4',
            'school', '#eee7d5',
            'university', '#eee7d5',
            'college', '#eee7d5',
            'hospital', '#f2dddd',
            'sports_centre', '#dcead9',
            '#ece9e4'
          ],
          'fill-opacity': 0.85
        }
      },
      {
        id: 'atlas-boundaries',
        type: 'line',
        source: VECTOR_SOURCE,
        'source-layer': 'boundaries',
        minzoom: 3,
        paint: {
          'line-color': '#a7abb4',
          'line-width': [
            'match', ['get', 'admin_level'],
            2, 1.25,
            4, 0.8,
            0.6
          ],
          'line-dasharray': [3, 2],
          'line-opacity': 0.65
        }
      },
      {
        id: 'atlas-minor-roads-casing',
        type: 'line',
        source: VECTOR_SOURCE,
        'source-layer': 'streets',
        minzoom: 12,
        filter: [
          'match', ['get', 'kind'],
          ['residential', 'living_street', 'unclassified', 'service', 'pedestrian'],
          true,
          false
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#d0cec8',
          'line-width': ['+', minorRoadWidth, 1.4]
        }
      },
      {
        id: 'atlas-minor-roads',
        type: 'line',
        source: VECTOR_SOURCE,
        'source-layer': 'streets',
        minzoom: 12,
        filter: [
          'match', ['get', 'kind'],
          ['residential', 'living_street', 'unclassified', 'service', 'pedestrian'],
          true,
          false
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': minorRoadWidth
        }
      },
      {
        id: 'atlas-major-roads-casing',
        type: 'line',
        source: VECTOR_SOURCE,
        'source-layer': 'streets',
        minzoom: 5,
        filter: [
          'match', ['get', 'kind'],
          ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'],
          true,
          false
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#c8c3bc',
          'line-width': roadCasingWidth
        }
      },
      {
        id: 'atlas-major-roads',
        type: 'line',
        source: VECTOR_SOURCE,
        'source-layer': 'streets',
        minzoom: 5,
        filter: [
          'match', ['get', 'kind'],
          ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'],
          true,
          false
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': [
            'match', ['get', 'kind'],
            'motorway', '#eb9f9a',
            'motorway_link', '#ebaaa3',
            'trunk', '#efbb80',
            'trunk_link', '#efc28e',
            'primary', '#f2d296',
            'primary_link', '#f2d8a5',
            'secondary', '#fff5d7',
            'secondary_link', '#fff5d7',
            '#ffffff'
          ],
          'line-width': roadWidth
        }
      },
      {
        id: 'atlas-paths',
        type: 'line',
        source: VECTOR_SOURCE,
        'source-layer': 'streets',
        minzoom: 14,
        filter: [
          'match', ['get', 'kind'],
          ['footway', 'path', 'cycleway', 'steps', 'track'],
          true,
          false
        ],
        paint: {
          'line-color': '#b8b5ae',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            14, 0.7,
            18, 2.2
          ],
          'line-dasharray': [2, 1.5],
          'line-opacity': 0.75
        }
      },
      {
        id: 'atlas-buildings',
        type: 'fill',
        source: VECTOR_SOURCE,
        'source-layer': 'buildings',
        minzoom: 14,
        paint: {
          'fill-color': '#d9d5cf',
          'fill-outline-color': '#c8c3bc',
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            14, 0.65,
            17, 0.9
          ]
        }
      },
      {
        id: 'atlas-road-labels',
        type: 'symbol',
        source: VECTOR_SOURCE,
        'source-layer': 'street_labels',
        minzoom: 11,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 300,
          'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ''],
          'text-font': FONT_REGULAR,
          'text-size': labelSize,
          'text-max-angle': 35,
          'text-padding': 4,
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport'
        },
        paint: {
          'text-color': '#4e5562',
          'text-halo-color': 'rgba(255,255,255,0.96)',
          'text-halo-width': 1.6,
          'text-halo-blur': 0.4
        }
      },
      {
        id: 'atlas-place-labels',
        type: 'symbol',
        source: VECTOR_SOURCE,
        'source-layer': 'place_labels',
        minzoom: 4,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_SEMIBOLD,
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            4, [
              'match', ['get', 'kind'],
              'capital', 17,
              'city', 15,
              'town', 13,
              11
            ],
            10, [
              'match', ['get', 'kind'],
              'capital', 19,
              'city', 17,
              'town', 15,
              13
            ],
            14, 15
          ],
          'text-padding': 8,
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#303744',
          'text-halo-color': 'rgba(255,255,255,0.95)',
          'text-halo-width': 1.8
        }
      },
      {
        id: 'atlas-poi-labels',
        type: 'symbol',
        source: VECTOR_SOURCE,
        'source-layer': 'pois',
        minzoom: 14,
        filter: ['has', 'name'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_REGULAR,
          'text-size': 11,
          'text-offset': [0, 0.8],
          'text-anchor': 'top',
          'text-padding': 5,
          'text-optional': true
        },
        paint: {
          'text-color': '#596170',
          'text-halo-color': 'rgba(255,255,255,0.96)',
          'text-halo-width': 1.4
        }
      },
      {
        id: 'atlas-house-numbers',
        type: 'symbol',
        source: VECTOR_SOURCE,
        'source-layer': 'addresses',
        minzoom: 17,
        filter: ['has', 'housenumber'],
        layout: {
          'text-field': ['get', 'housenumber'],
          'text-font': FONT_REGULAR,
          'text-size': 9,
          'text-padding': 2
        },
        paint: {
          'text-color': '#818793',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 1
        }
      }
    ]
  };
}
