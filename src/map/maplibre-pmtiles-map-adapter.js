import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  MapLibreMapAdapter
} from './maplibre-map-adapter.js';
import {
  createMapLibrePmtilesStyle
} from './layers/maplibre-pmtiles-style.js';
import {
  installMapLibreZoomControl
} from './maplibre-zoom-control.js';

const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
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
    traveled: [
      ...points.slice(0, segmentIndex + 1),
      interpolated
    ],
    remaining: [
      interpolated,
      ...points.slice(segmentIndex + 1)
    ]
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

  return normalizeBearing(
    Math.atan2(y, x) * 180 / Math.PI
  );
}

function validRoute(route) {
  const points = route?.points ?? [];
  return (
    points.length >= 2 &&
    points.every(
      point =>
        Number.isFinite(point?.lat) &&
        Number.isFinite(point?.lon)
    )
  );
}

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

    this.currentRoute = null;
    this.currentRouteProgress = null;
    this.currentManeuvers = null;
    this.currentManeuverIndex = 0;
    this.mapSourceMode = 'online';

    // Do not use map.isStyleLoaded() as a gate for route rendering. In
    // MapLibre it can remain false while raster/vector source tiles are still
    // loading even though style.load has already fired. Waiting for another
    // style.load in that state can strand the route forever. Track the
    // style-load lifecycle explicitly instead.
    this.atlasStyleReady = false;

    this.zoomControlElement =
      installMapLibreZoomControl(this.map);

    this.mapSourceBadge =
      document.createElement('div');
    this.mapSourceBadge.className =
      'atlas-maplibre-source-badge';
    this.map.getContainer().appendChild(
      this.mapSourceBadge
    );
    this.#renderMapSourceBadge();

    this.map.on('style.load', () => {
      this.atlasStyleReady = true;
      this.#renderStoredRoute();
    });

    // The initial style can theoretically finish before this subclass has
    // installed its listener. In that case the style object is already ready
    // for mutations and the initial renderer can proceed immediately.
    if (this.map.isStyleLoaded?.()) {
      this.atlasStyleReady = true;
    }
  }

  async setRegion(region, options = {}) {
    const preferOffline =
      Boolean(options?.preferOffline);

    // A new setStyle() invalidates all application-owned layers. Mark the
    // renderer unavailable before the base adapter begins the style swap;
    // style.load above is the only event that marks it ready again.
    this.atlasStyleReady = false;

    const offlineLoaded =
      await super.setRegion(region, options);

    this.mapSourceMode =
      preferOffline && offlineLoaded
        ? 'offline'
        : 'online';

    this.#renderMapSourceBadge();
    return offlineLoaded;
  }

  showRoute(route, endpoints = {}) {
    if (!validRoute(route)) {
      throw new TypeError(
        'showRoute requires at least two valid route points.'
      );
    }

    this.currentRoute = route;
    this.currentRouteProgress = null;

    if (this.atlasStyleReady) {
      this.#renderStoredRoute();
    }

    // Camera fitting is independent of style/source loading and can happen
    // immediately, so the preview framing stays responsive.
    this.fitRoute(route);
    return true;
  }

  updateRouteProgress(route, progress) {
    if (validRoute(route)) {
      this.currentRoute = route;
    }

    this.currentRouteProgress = progress ?? null;
    this.navigationRouteProgress = progress ?? null;

    if (!this.currentRoute || !validRoute(this.currentRoute)) {
      return;
    }

    this.routeBearing = bearingFromProgress(
      this.currentRoute.points,
      progress
    );

    if (!this.atlasStyleReady) {
      return;
    }

    const split = splitRoute(
      this.currentRoute.points,
      progress
    );

    const routeSource = this.map.getSource(ROUTE_SOURCE);
    if (!routeSource) {
      this.#renderStoredRoute();
      return;
    }

    routeSource.setData(
      collection([lineFeature(split.remaining)])
    );

    let traveledSource =
      this.map.getSource(TRAVELED_SOURCE);

    if (!traveledSource) {
      this.map.addSource(TRAVELED_SOURCE, {
        type: 'geojson',
        data: collection([lineFeature(split.traveled)])
      });

      this.map.addLayer({
        id: 'atlas-route-traveled',
        type: 'line',
        source: TRAVELED_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#737b8c',
          'line-width': 5,
          'line-opacity': 0.88
        }
      });
    } else {
      traveledSource.setData(
        collection([lineFeature(split.traveled)])
      );
    }

    this.#raiseRouteLayers();
  }

  showManeuvers(maneuvers, activeIndex = 0) {
    this.currentManeuvers =
      Array.isArray(maneuvers)
        ? maneuvers
        : null;
    this.currentManeuverIndex = activeIndex;

    return super.showManeuvers(
      maneuvers,
      activeIndex
    );
  }

  clearManeuvers() {
    this.currentManeuvers = null;
    this.currentManeuverIndex = 0;
    return super.clearManeuvers();
  }

  clearRoute() {
    this.currentRoute = null;
    this.currentRouteProgress = null;
    this.routeBearing = null;
    this.navigationRouteProgress = null;
    this.navigationCameraZoom = null;
    this.navigationCameraTimestamp = null;

    if (!this.atlasStyleReady) {
      return;
    }

    this.#removeRouteOverlay();
  }

  #renderStoredRoute() {
    if (
      !this.atlasStyleReady ||
      !validRoute(this.currentRoute)
    ) {
      return;
    }

    this.#removeRouteOverlay();

    const points = this.currentRoute.points;
    const split = this.currentRouteProgress
      ? splitRoute(points, this.currentRouteProgress)
      : null;

    this.map.addSource(ROUTE_SOURCE, {
      type: 'geojson',
      data: collection([
        lineFeature(
          split?.remaining ?? points
        )
      ])
    });

    this.map.addLayer({
      id: 'atlas-route-casing',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 10,
        'line-opacity': 0.96
      }
    });

    this.map.addLayer({
      id: 'atlas-route-remaining',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#315efb',
        'line-width': 6,
        'line-opacity': 1
      }
    });

    if (split) {
      this.map.addSource(TRAVELED_SOURCE, {
        type: 'geojson',
        data: collection([lineFeature(split.traveled)])
      });

      this.map.addLayer({
        id: 'atlas-route-traveled',
        type: 'line',
        source: TRAVELED_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#737b8c',
          'line-width': 6,
          'line-opacity': 0.9
        }
      });
    }

    this.#raiseRouteLayers();
  }

  #raiseRouteLayers() {
    // addLayer() without beforeId already appends above the base style. Move
    // explicitly as a defensive guarantee after style swaps and progress
    // updates so the route can never sit underneath a raster/vector base.
    for (const layerId of [
      'atlas-route-casing',
      'atlas-route-traveled',
      'atlas-route-remaining'
    ]) {
      if (this.map.getLayer(layerId)) {
        this.map.moveLayer(layerId);
      }
    }
  }

  #removeRouteOverlay() {
    for (const layerId of [
      'atlas-route-traveled',
      'atlas-route-remaining',
      'atlas-route-casing'
    ]) {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    }

    for (const sourceId of [
      TRAVELED_SOURCE,
      ROUTE_SOURCE
    ]) {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    }
  }

  #renderMapSourceBadge() {
    if (!this.mapSourceBadge) return;

    const offline =
      this.mapSourceMode === 'offline';

    this.mapSourceBadge.textContent =
      offline ? 'Offline map' : 'Online map';
    this.mapSourceBadge.dataset.mode =
      offline ? 'offline' : 'online';
    this.mapSourceBadge.title =
      offline
        ? 'Atlas is using the downloaded regional map.'
        : 'Atlas is using the online OpenStreetMap layer.';
  }
}
