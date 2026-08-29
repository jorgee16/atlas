import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function validRoute(route) {
  const points = route?.points ?? [];
  return points.length >= 2 && points.every(validPoint);
}

function lineFeature(points) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map(point => [point.lon, point.lat])
    }
  };
}

function collection(features) {
  return {
    type: 'FeatureCollection',
    features
  };
}

function splitRoute(points, progress = {}) {
  const segmentIndex = Math.max(
    0,
    Math.min(
      points.length - 1,
      Number.isInteger(progress?.segmentIndex)
        ? progress.segmentIndex
        : Number.isInteger(progress?.pointIndex)
          ? progress.pointIndex
          : 0
    )
  );

  const fraction = Number.isFinite(progress?.segmentFraction)
    ? Math.max(0, Math.min(1, progress.segmentFraction))
    : 0;

  const current = points[segmentIndex];
  const next = points[segmentIndex + 1] ?? current;
  const interpolated = {
    lat: current.lat + (next.lat - current.lat) * fraction,
    lon: current.lon + (next.lon - current.lon) * fraction
  };

  return {
    traveled: [...points.slice(0, segmentIndex + 1), interpolated],
    remaining: [interpolated, ...points.slice(segmentIndex + 1)]
  };
}

function bearingFromProgress(points, progress = {}) {
  if (points.length < 2) return null;

  const index = Math.max(
    0,
    Math.min(
      points.length - 2,
      Number.isInteger(progress?.segmentIndex)
        ? progress.segmentIndex
        : Number.isInteger(progress?.pointIndex)
          ? progress.pointIndex
          : 0
    )
  );

  const from = points[index];
  const to = points[index + 1];
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

function ensureTraveledLayer(adapter, traveled) {
  if (!adapter.map.getSource(TRAVELED_SOURCE)) {
    adapter.map.addSource(TRAVELED_SOURCE, {
      type: 'geojson',
      data: collection([lineFeature(traveled)])
    });
  }

  if (!adapter.map.getLayer('atlas-route-traveled')) {
    adapter.map.addLayer({
      id: 'atlas-route-traveled',
      type: 'line',
      source: TRAVELED_SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#737b8c',
        'line-width': 7,
        'line-opacity': 0.9
      }
    });
  }
}

export function installMapLibreRouteStability() {
  const prototype = MapLibrePmtilesMapAdapter?.prototype;
  if (!prototype || prototype.__atlasStableRouteProgressInstalled) {
    return;
  }

  const originalUpdateRouteProgress = prototype.updateRouteProgress;

  Object.defineProperty(
    prototype,
    '__atlasStableRouteProgressInstalled',
    { value: true }
  );

  prototype.updateRouteProgress = function updateRouteProgress(route, progress) {
    if (validRoute(route)) {
      this.currentRoute = route;
    }

    this.currentRouteProgress = progress ?? null;
    this.navigationRouteProgress = progress ?? null;

    if (!validRoute(this.currentRoute)) return;

    this.routeBearing = bearingFromProgress(
      this.currentRoute.points,
      progress
    );

    // The previous MapLibre implementation removed and recreated every
    // route source/layer for every GPS progress update. WebGL briefly had no
    // route between those operations, which made the path visibly blink even
    // while the user was stationary. Keep the layers mounted and only mutate
    // their GeoJSON data, matching the stable Leaflet behaviour.
    try {
      const remainingSource = this.map.getSource?.(ROUTE_SOURCE);
      const styleReady = this.map.isStyleLoaded?.() ?? false;

      if (!remainingSource || !styleReady) {
        return originalUpdateRouteProgress.call(this, route, progress);
      }

      const split = splitRoute(
        this.currentRoute.points,
        progress
      );

      remainingSource.setData(
        collection([lineFeature(split.remaining)])
      );

      ensureTraveledLayer(this, split.traveled);
      this.map
        .getSource(TRAVELED_SOURCE)
        ?.setData(collection([lineFeature(split.traveled)]));

      // Keep route layers above the base map without tearing them down.
      for (const layerId of [
        'atlas-route-casing',
        'atlas-route-traveled',
        'atlas-route-remaining'
      ]) {
        if (this.map.getLayer?.(layerId)) {
          this.map.moveLayer?.(layerId);
        }
      }

      this.map.triggerRepaint?.();
    } catch (error) {
      console.warn(
        'Stable MapLibre route progress update failed; falling back to full render.',
        error
      );
      originalUpdateRouteProgress.call(this, route, progress);
    }
  };
}
