import { LeafletMapAdapter } from './leaflet-map-adapter.js';
import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';
import {
  installMapLibreGpsParity
} from './maplibre-gps-parity.js';
import {
  installMapLibreRouteStability
} from './maplibre-route-stability.js';

installMapLibreRouteStability();

export const MAP_RENDERER = Object.freeze({
  LEAFLET: 'leaflet',
  MAPLIBRE: 'maplibre'
});

const DEFAULT_RENDERER = MAP_RENDERER.MAPLIBRE;

const MAPLIBRE_ANDROID_VECTOR_STYLE = {
  version: 8,
  name: 'Atlas VersaTiles direct MVT',
  glyphs:
    'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      tiles: [
        'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'
      ],
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
      paint: { 'background-color': '#f3f1ec' }
    },
    {
      id: 'atlas-land',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'land',
      minzoom: 7,
      paint: {
        'fill-color': [
          'match',
          ['get', 'kind'],
          'forest', '#d9e8d2',
          'wood', '#d9e8d2',
          'grass', '#e3edd9',
          'grassland', '#e3edd9',
          'meadow', '#e8efdf',
          'park', '#dfead8',
          'recreation_ground', '#e2ecda',
          'orchard', '#e1ead5',
          'vineyard', '#e4ead9',
          'farmland', '#eee9d8',
          'farmyard', '#eee6d7',
          'cemetery', '#dfe8d8',
          'residential', '#f0efea',
          'commercial', '#eee9e5',
          'retail', '#f0e8e5',
          'industrial', '#e9e7e3',
          'railway', '#e8e6e2',
          'quarry', '#e4dfd8',
          'wetland', '#dce8dd',
          'beach', '#f4e8c7',
          'sand', '#f3e6c5',
          '#e8eadf'
        ],
        'fill-opacity': 0.88
      }
    },
    {
      id: 'atlas-ocean',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'ocean',
      paint: { 'fill-color': '#b9dceb' }
    },
    {
      id: 'atlas-water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water_polygons',
      paint: { 'fill-color': '#b9dceb' }
    },
    {
      id: 'atlas-buildings',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'buildings',
      minzoom: 14,
      paint: {
        'fill-color': '#d8d4ce',
        'fill-outline-color': '#c5c0b9'
      }
    },
    {
      id: 'atlas-roads-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'streets',
      minzoom: 5,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#c7c2bb',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 0.8,
          10, 2,
          14, 5.2,
          18, 11
        ]
      }
    },
    {
      id: 'atlas-roads',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'streets',
      minzoom: 5,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': [
          'match',
          ['get', 'kind'],
          'motorway', '#e8aaa3',
          'motorway_link', '#e8aaa3',
          'trunk', '#efc48e',
          'trunk_link', '#efc48e',
          'primary', '#f0d7aa',
          'primary_link', '#f0d7aa',
          '#ffffff'
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 0.45,
          10, 1.35,
          14, 3.7,
          18, 8.7
        ]
      }
    },
    {
      id: 'atlas-street-labels',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'street_labels',
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 300,
        'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ''],
        'text-font': ['fira_sans_regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          12, 10,
          14, 11,
          16, 12.5,
          18, 14
        ],
        'text-padding': 4,
        'text-max-angle': 35,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#4e5562',
        'text-halo-color': 'rgba(255,255,255,0.96)',
        'text-halo-width': 1.6,
        'text-halo-blur': 0.35
      }
    },
    {
      id: 'atlas-poi-labels',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'pois',
      minzoom: 14,
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['fira_sans_regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          14, 10,
          16, 11,
          18, 12
        ],
        'text-anchor': 'top',
        'text-offset': [0, 0.55],
        'text-padding': 5,
        'text-max-width': 12,
        'text-optional': true,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#5d6470',
        'text-halo-color': 'rgba(255,255,255,0.96)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.25
      }
    },
    {
      id: 'atlas-place-labels',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place_labels',
      minzoom: 4,
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-font': ['fira_sans_regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          4, 11,
          8, 13,
          12, 15,
          15, 16
        ],
        'text-padding': 7,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#303744',
        'text-halo-color': 'rgba(255,255,255,0.96)',
        'text-halo-width': 1.8
      }
    }
  ]
};

export function createMapAdapter({
  renderer = DEFAULT_RENDERER,
  adapterOptions = {}
} = {}) {
  switch (renderer) {
    case MAP_RENDERER.LEAFLET:
      return new LeafletMapAdapter(adapterOptions);
    case MAP_RENDERER.MAPLIBRE:
      return installMapLibreGpsParity(
        new MapLibrePmtilesMapAdapter({
          ...adapterOptions,
          style:
            adapterOptions.style ??
            MAPLIBRE_ANDROID_VECTOR_STYLE
        })
      );
    default:
      throw new RangeError(`Unsupported map renderer: ${renderer}`);
  }
}
