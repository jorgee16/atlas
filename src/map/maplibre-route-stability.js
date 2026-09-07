import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';
const STAGED_ROUTE_SOURCE = 'atlas-route-staged';
const STAGED_ROUTE_CASING = 'atlas-route-staged-casing';
const STAGED_ROUTE_LINE = 'atlas-route-staged-line';
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

function routeData(route, progress = null) {
  if (!validRoute(route)) return collection([]);
  const split = progress ? splitRoute(route.points, progress) : null;
  return collection([lineFeature(split?.remaining ?? route.points)]);
}

function updateExistingRouteSources(adapter, route, progress = null) {
  const remainingSource = adapter.map.getSource?.(ROUTE_SOURCE);
  const styleReady = adapter.map.isStyleLoaded?.() ?? false;

  if (!remainingSource || !styleReady || !validRoute(route)) {
    return false;
  }

  const split = progress ? splitRoute(route.points, progress) : null;
  remainingSource.setData(routeData(route, progress));

  if (split) {
    ensureTraveledLayer(adapter, split.traveled);
    adapter.map
      .getSource(TRAVELED_SOURCE)
      ?.setData(collection([lineFeature(split.traveled)]));
  } else {
    adapter.map
      .getSource(TRAVELED_SOURCE)
      ?.setData(collection([]));
  }

  return true;
}

function removeStagedRoute(adapter) {
  for (const layerId of [STAGED_ROUTE_LINE, STAGED_ROUTE_CASING]) {
    if (adapter.map.getLayer?.(layerId)) {
      adapter.map.removeLayer(layerId);
    }
  }

  if (adapter.map.getSource?.(STAGED_ROUTE_SOURCE)) {
    adapter.map.removeSource(STAGED_ROUTE_SOURCE);
  }
}

function stageReroute(adapter, route) {
  removeStagedRoute(adapter);

  adapter.map.addSource(STAGED_ROUTE_SOURCE, {
    type: 'geojson',
    data: routeData(route)
  });

  adapter.map.addLayer({
    id: STAGED_ROUTE_CASING,
    type: 'line',
    source: STAGED_ROUTE_SOURCE,
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': 12,
      'line-opacity': 0.98
    }
  });

  adapter.map.addLayer({
    id: STAGED_ROUTE_LINE,
    type: 'line',
    source: STAGED_ROUTE_SOURCE,
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    },
    paint: {
      'line-color': '#2563eb',
      'line-width': 7,
      'line-opacity': 1
    }
  });

  adapter.__atlasPendingReroute = {
    route,
    progress: null,
    promoted: false
  };

  const promote = () => {
    const pending = adapter.__atlasPendingReroute;
    if (!pending || pending.route !== route || pending.promoted) return;

    pending.promoted = true;

    try {
      updateExistingRouteSources(
        adapter,
        pending.route,
        pending.progress
      );
      adapter.currentRoute = pending.route;
      adapter.currentRouteProgress = pending.progress;
      adapter.navigationRouteProgress = pending.progress;
      adapter.routeBearing = pending.progress
        ? bearingFromProgress(pending.route.points, pending.progress)
        : null;

      adapter.__atlasRenderedProgressRoute = pending.route;
      adapter.__atlasRenderedProgressPoint = pending.progress
        ? progressPoint(pending.route.points, pending.progress)
        : null;
      adapter.__atlasRenderedProgressSegmentIndex = pending.progress
        ? progressSegmentIndex(pending.route.points, pending.progress)
        : undefined;

      const cleanup = () => {
        removeStagedRoute(adapter);
        if (adapter.__atlasPendingReroute === pending) {
          adapter.__atlasPendingReroute = null;
        }
      };

      if (typeof globalThis.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(cleanup)
        );
      } else {
        globalThis.setTimeout(cleanup, 34);
      }
    } catch (error) {
      console.warn('Unable to promote staged MapLibre reroute.', error);
      removeStagedRoute(adapter);
      adapter.__atlasPendingReroute = null;
    }
  };

  // `idle` fires only after MapLibre has rendered the staged GeoJSON. Until
  // then the old route remains visible underneath, so there is never a frame
  // with no blue route. The timeout is a defensive fallback for test doubles
  // and unusual render loops.
  if (typeof adapter.map.once === 'function') {
    adapter.map.once('idle', promote);
    globalThis.setTimeout?.(promote, 250);
  } else {
    globalThis.setTimeout?.(promote, 34);
  }

  return true;
}

export function installMapLibreRouteStability() {
  const prototype = MapLibrePmtilesMapAdapter?.prototype;
  if (!prototype || prototype.__atlasStableRouteProgressInstalled) {
    return;
  }

  const originalShowRoute = prototype.showRoute;
  const originalUpdateRouteProgress = prototype.updateRouteProgress;
  const originalClearRoute = prototype.clearRoute;

  Object.defineProperty(
    prototype,
    '__atlasStableRouteProgressInstalled',
    { value: true }
  );

  prototype.showRoute = function showRouteWithoutRerouteFlash(route, ...args) {
    if (!validRoute(route)) {
      return originalShowRoute.call(this, route, ...args);
    }

    const activeNavigationReroute =
      validRoute(this.currentRoute) &&
      Boolean(this.currentRouteProgress) &&
      Boolean(this.map.getSource?.(ROUTE_SOURCE));

    if (!activeNavigationReroute) {
      return originalShowRoute.call(this, route, ...args);
    }

    try {
      return stageReroute(this, route);
    } catch (error) {
      console.warn(
        'Double-buffered MapLibre reroute failed; falling back to direct swap.',
        error
      );

      if (updateExistingRouteSources(this, route, null)) {
        this.currentRoute = route;
        this.currentRouteProgress = null;
        this.navigationRouteProgress = null;
        this.routeBearing = null;
        return true;
      }
    }

    return originalShowRoute.call(this, route, ...args);
  };

  prototype.updateRouteProgress = function updateRouteProgress(route, progress) {
    const pending = this.__atlasPendingReroute;

    if (
      pending &&
      !pending.promoted &&
      route === pending.route
    ) {
      pending.progress = progress ?? null;
      this.routeBearing = progress
        ? bearingFromProgress(route.points, progress)
        : null;

      try {
        this.map
          .getSource?.(STAGED_ROUTE_SOURCE)
          ?.setData(routeData(route, progress));
      } catch (error) {
        console.warn('Unable to update staged reroute progress.', error);
      }
      return;
    }

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

    if (
      sameRoute &&
      sameSegment &&
      progressMovement < renderDeadband
    ) {
      return;
    }

    try {
      if (!updateExistingRouteSources(this, this.currentRoute, progress)) {
        this.__atlasRenderedProgressRoute = this.currentRoute;
        this.__atlasRenderedProgressPoint = renderedPoint;
        this.__atlasRenderedProgressSegmentIndex = segmentIndex;
        return originalUpdateRouteProgress.call(this, route, progress);
      }

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
    removeStagedRoute(this);
    this.__atlasPendingReroute = null;
    this.__atlasRenderedProgressRoute = null;
    this.__atlasRenderedProgressPoint = null;
    this.__atlasRenderedProgressSegmentIndex = undefined;
    return originalClearRoute.apply(this, args);
  };
}
