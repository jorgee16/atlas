import { LeafletMapAdapter } from './leaflet-map-adapter.js';
import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

export const MAP_RENDERER = Object.freeze({
  LEAFLET: 'leaflet',
  MAPLIBRE: 'maplibre'
});

const DEFAULT_RENDERER = MAP_RENDERER.MAPLIBRE;

// Android diagnostic style: keep the entire style local/in-memory and point
// the vector source straight at the public tile template. This deliberately
// bypasses both a remote style.json fetch and TileJSON resolution so we can
// isolate whether Capacitor/WebView can fetch and render MVT tiles at all.
// VersaTiles documents this direct public endpoint for its Shortbread OSM
// tileset: https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}
const MAPLIBRE_ANDROID_VECTOR_STYLE = {
  version: 8,
  name: 'Atlas VersaTiles direct MVT',
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
          'forest', '#dce8d4',
          'grass', '#e4edd8',
          'meadow', '#e7eedc',
          'orchard', '#e3ead8',
          'vineyard', '#e3ead8',
          '#e8eadf'
        ],
        'fill-opacity': 0.82
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
      return new MapLibrePmtilesMapAdapter({
        ...adapterOptions,
        style:
          adapterOptions.style ??
          MAPLIBRE_ANDROID_VECTOR_STYLE
      });
    default:
      throw new RangeError(`Unsupported map renderer: ${renderer}`);
  }
}
