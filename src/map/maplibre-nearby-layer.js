import { MapLibreMapAdapter } from './maplibre-map-adapter.js';

const NEARBY_SOURCE_ID = 'atlas-nearby';
const NEARBY_CASING_LAYER_ID = 'atlas-nearby-casing';
const NEARBY_LAYER_ID = 'atlas-nearby-points';

function collection(features) {
  return {
    type: 'FeatureCollection',
    features
  };
}

function validPoint(place) {
  return Number.isFinite(place?.lat) && Number.isFinite(place?.lon);
}

function ensureState(adapter) {
  if (adapter.__atlasNearbyLayerState) {
    return adapter.__atlasNearbyLayerState;
  }

  const state = {
    features: [],
    flushScheduled: false,
    styleWaitInstalled: false,
    popup: null,
    clickInstalled: false
  };

  Object.defineProperty(adapter, '__atlasNearbyLayerState', {
    value: state
  });

  const map = adapter.map;

  if (map && !state.clickInstalled) {
    state.clickInstalled = true;
    map.on('click', event => {
      if (!map.getLayer?.(NEARBY_LAYER_ID) || !event?.point) return;

      const features = map.queryRenderedFeatures?.(event.point, {
        layers: [NEARBY_LAYER_ID]
      }) ?? [];
      const feature = features[0];
      if (!feature) return;

      const html = feature.properties?.popupHtml;
      if (!html || !event.lngLat) return;

      event.originalEvent?.stopPropagation?.();
      state.popup?.remove?.();
      state.popup = new adapter.maplibre.Popup({ offset: 12 })
        .setLngLat(event.lngLat)
        .setHTML(html)
        .addTo(map);
    });
  }

  return state;
}

function syncNearbyLayer(adapter) {
  const map = adapter.map;
  const state = ensureState(adapter);
  state.flushScheduled = false;

  if (!map?.isStyleLoaded?.()) {
    if (!state.styleWaitInstalled) {
      state.styleWaitInstalled = true;
      map?.once?.('style.load', () => {
        state.styleWaitInstalled = false;
        syncNearbyLayer(adapter);
      });
    }
    return;
  }

  const data = collection(state.features);
  const source = map.getSource?.(NEARBY_SOURCE_ID);

  if (source) {
    source.setData?.(data);
  } else {
    map.addSource?.(NEARBY_SOURCE_ID, {
      type: 'geojson',
      data
    });
  }

  if (!map.getLayer?.(NEARBY_CASING_LAYER_ID)) {
    map.addLayer?.({
      id: NEARBY_CASING_LAYER_ID,
      type: 'circle',
      source: NEARBY_SOURCE_ID,
      paint: {
        'circle-radius': 8.5,
        'circle-color': '#ffffff',
        'circle-opacity': 0.98
      }
    });
  }

  if (!map.getLayer?.(NEARBY_LAYER_ID)) {
    map.addLayer?.({
      id: NEARBY_LAYER_ID,
      type: 'circle',
      source: NEARBY_SOURCE_ID,
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#315efb',
        'circle-opacity': 1
      }
    });
  }
}

function scheduleSync(adapter) {
  const state = ensureState(adapter);
  if (state.flushScheduled) return;
  state.flushScheduled = true;

  queueMicrotask(() => {
    syncNearbyLayer(adapter);
  });
}

function removeNearbyLayer(adapter) {
  const map = adapter.map;
  const state = ensureState(adapter);

  state.features = [];
  state.popup?.remove?.();
  state.popup = null;

  if (!map?.isStyleLoaded?.()) return;

  for (const layerId of [NEARBY_LAYER_ID, NEARBY_CASING_LAYER_ID]) {
    if (map.getLayer?.(layerId)) {
      map.removeLayer?.(layerId);
    }
  }

  if (map.getSource?.(NEARBY_SOURCE_ID)) {
    map.removeSource?.(NEARBY_SOURCE_ID);
  }
}

const prototype = MapLibreMapAdapter?.prototype;

if (prototype && !prototype.__atlasNearbyWebglLayerInstalled) {
  Object.defineProperty(prototype, '__atlasNearbyWebglLayerInstalled', {
    value: true
  });

  prototype.clearNearby = function clearNearby() {
    removeNearbyLayer(this);
    this.nearbyMarkers = [];
  };

  prototype.addNearby = function addNearby(place, popupHtml) {
    if (!validPoint(place)) return;

    const state = ensureState(this);
    state.features.push({
      type: 'Feature',
      properties: {
        popupHtml: popupHtml ?? ''
      },
      geometry: {
        type: 'Point',
        coordinates: [place.lon, place.lat]
      }
    });

    scheduleSync(this);
  };
}
