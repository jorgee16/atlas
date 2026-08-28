import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  MapLibreMapAdapter
} from './maplibre-map-adapter.js';
import {
  createMapLibrePmtilesStyle
} from './layers/maplibre-pmtiles-style.js';

export class MapLibrePmtilesMapAdapter extends MapLibreMapAdapter {
  constructor({
    maplibre = maplibregl,
    createOfflineStyle = createMapLibrePmtilesStyle,
    ...options
  } = {}) {
    super({
      ...options,
      maplibre,
      createOfflineStyle
    });
  }
}
