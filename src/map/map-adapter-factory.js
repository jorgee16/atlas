import { LeafletMapAdapter } from './leaflet-map-adapter.js';
import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

export const MAP_RENDERER = Object.freeze({
  LEAFLET: 'leaflet',
  MAPLIBRE: 'maplibre'
});

const DEFAULT_RENDERER = MAP_RENDERER.LEAFLET;

export function createMapAdapter({
  renderer = DEFAULT_RENDERER,
  adapterOptions = {}
} = {}) {
  switch (renderer) {
    case MAP_RENDERER.LEAFLET:
      return new LeafletMapAdapter(adapterOptions);
    case MAP_RENDERER.MAPLIBRE:
      return new MapLibrePmtilesMapAdapter(adapterOptions);
    default:
      throw new RangeError(`Unsupported map renderer: ${renderer}`);
  }
}
