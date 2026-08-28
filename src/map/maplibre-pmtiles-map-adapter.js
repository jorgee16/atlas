import {
  MapLibreMapAdapter
} from './maplibre-map-adapter.js';
import {
  createMapLibrePmtilesStyle
} from './layers/maplibre-pmtiles-style.js';

export class MapLibrePmtilesMapAdapter extends MapLibreMapAdapter {
  constructor({
    createOfflineStyle = createMapLibrePmtilesStyle,
    ...options
  } = {}) {
    super({
      ...options,
      createOfflineStyle
    });
  }
}
