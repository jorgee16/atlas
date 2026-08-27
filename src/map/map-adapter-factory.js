import { LeafletMapAdapter } from './leaflet-map-adapter.js';

export const MAP_RENDERER = Object.freeze({
  LEAFLET: 'leaflet'
});

const DEFAULT_RENDERER = MAP_RENDERER.LEAFLET;

export function createMapAdapter({
  renderer = DEFAULT_RENDERER,
  adapterOptions = {}
} = {}) {
  switch (renderer) {
    case MAP_RENDERER.LEAFLET:
      return new LeafletMapAdapter(adapterOptions);
    default:
      throw new RangeError(`Unsupported map renderer: ${renderer}`);
  }
}
