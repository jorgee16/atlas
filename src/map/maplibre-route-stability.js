import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';
const WALK_PROGRESS_RENDER_DEADBAND_METERS = 2.5;
const DRIVE_PROGRESS_RENDER_DEADBAND_METERS = 4;
const EARTH_RADIUS_METERS = 6371000;

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

function progressSegmentIndex(points, progress = {}) {
  return Math.max(
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
}

function progressPoint(points, progress = {}) {
  const segmentIndex = progressSegmentIndex(points, progress);
  const fraction = Number.isFinite(progress?.segmentFraction)
    ? Math.max(0, Math.min(1, progress.segmentFraction))
    : 0;
  const current = points[segmentIndex];
  const next = points[segmentIndex + 1] ?? current;

  return {
    lat: current.lat + (next.lat - current.lat) * fraction,
    lon: current.lon + (next.lon - current.lon) * fraction
  };
}

function distanceMeters(a, b) {
  if (!validPoint(a) || !validPoint(b)) return Infinity;

  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  );
}

function splitRoute(points, progress = {}) {
  const segmentIndex = progressSegmentIndex(points, progress);
  const interpolated = progressPoint(points, progress);

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
      progressSegmentIndex(points, progress)
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
  const originalClearRoute = prototype.clearRoute;

  Object.defineProperty(
    prototype,
    '__atlasStableRouteProgressInstalled',
    { value: true }
  );

  prototype.updateRouteProgress = function updateRouteProgress(route, progress) {
    const routeChanged =
      validRoute(route) &&
      route !== this.currentRoute;

    if (validRoute(route)) {
      this.currentRoute = route;
    }

    this.currentRouteProgress = progress ?? null;
    this.navigationRouteProgress = progress ?? null;

    if (!validRoute(this.currentRoute)) return;

    const points = this.currentRoute.points;
    const segmentIndex = progressSegmentIndex(points, progress);
    const renderedPoint = progressPoint(points, progress);

    this.routeBearing = bearingFromProgress(points, progress);

    const previousRoute = this.__atlasRenderedProgressRoute ?? null;
    const previousPoint = this.__atlasRenderedProgressPoint ?? null;
    const previousSegmentIndex =
      this.__atlasRenderedProgressSegmentIndex;
    const renderDeadband =
      this.navigationTravelMode === 'drive'
        ? DRIVE_PROGRESS_RENDER_DEADBAND_METERS
        : WALK_PROGRESS_RENDER_DEADBAND_METERS;

    const sameRoute =
      !routeChanged &&
      previousRoute === this.currentRoute;
    const sameSegment =
      Number.isInteger(previousSegmentIndex) &&
      previousSegmentIndex === segmentIndex;
    const progressMovement =
      distanceMeters(previousPoint, renderedPoint);

    // GPS and guidance can keep updating at their normal rate. The route
    // geometry does not need to be pushed through MapLibre for every noisy
    // fix. While progress remains on the same segment and moves less than a
    // few metres, leave the already-rendered route completely untouched.
    if (
      sameRoute &&
      sameSegment &&
      progressMovement < renderDeadband
    ) {
      return;
    }

    try {
      const remainingSource = this.map.getSource?.(ROUTE_SOURCE);
      const styleReady = this.map.isStyleLoaded?.() ?? false;

      if (!remainingSource || !styleReady) {
        this.__atlasRenderedProgressRoute = this.currentRoute;
        this.__atlasRenderedProgressPoint = renderedPoint;
        this.__atlasRenderedProgressSegmentIndex = segmentIndex;
        return originalUpdateRouteProgress.call(this, route, progress);
      }

      const split = splitRoute(points, progress);

      remainingSource.setData(
        collection([lineFeature(split.remaining)])
      );

      ensureTraveledLayer(this, split.traveled);
      this.map
        .getSource(TRAVELED_SOURCE)
        ?.setData(collection([lineFeature(split.traveled)]));

      // setData() schedules the MapLibre render itself. Do not force an extra
      // repaint for every GPS fix, and do not reorder layers repeatedly.
      this.__atlasRenderedProgressRoute = this.currentRoute;
      this.__atlasRenderedProgressPoint = renderedPoint;
      this.__atlasRenderedProgressSegmentIndex = segmentIndex;
    } catch (error) {
      console.warn(
        'Stable MapLibre route progress update failed; falling back to full render.',
        error
      );
      this.__atlasRenderedProgressRoute = this.currentRoute;
      this.__atlasRenderedProgressPoint = renderedPoint;
      this.__atlasRenderedProgressSegmentIndex = segmentIndex;
      originalUpdateRouteProgress.call(this, route, progress);
    }
  };

  prototype.clearRoute = function clearRoute(...args) {
    this.__atlasRenderedProgressRoute = null;
    this.__atlasRenderedProgressPoint = null;
    this.__atlasRenderedProgressSegmentIndex = undefined;
    return originalClearRoute.apply(this, args);
  };
}
