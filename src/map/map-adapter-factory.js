import { LeafletMapAdapter } from './leaflet-map-adapter.js';
import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

export const MAP_RENDERER = Object.freeze({
  LEAFLET: 'leaflet',
  MAPLIBRE: 'maplibre'
});

const DEFAULT_RENDERER = MAP_RENDERER.MAPLIBRE;

// OpenFreeMap's /planet TileJSON endpoint has recently had CORS restrictions
// for non-localhost web origins. Atlas runs MapLibre GL JS inside a Capacitor
// Android WebView, so the style can exist while the vector source stays in a
// permanent loading state. VersaTiles explicitly publishes this MapLibre style
// for browser/mobile use without an API key, making it a better validation
// source for the WebView renderer.
const MAPLIBRE_ANDROID_VECTOR_STYLE =
  'https://tiles.versatiles.org/assets/styles/colorful/style.json';

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
