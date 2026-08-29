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

// Use MapLibre's own public demo style as a controlled diagnostic baseline.
// If this style fails inside the Android WebView, the problem is no longer our
// PMTiles schema or OpenFreeMap style choice; the visible error panel below
// will expose the actual MapLibre/WebView resource error.
const ONLINE_VECTOR_STYLE =
  'https://demotiles.maplibre.org/style.json';

const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';
const ROUTE_LAYER_IDS = [
  'atlas-route-traveled',
  'atlas-route-remaining',
  'atlas-route-casing'
];

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

function mapErrorMessage(event) {
  const error = event?.error ?? event;
  return String(
    error?.message ??
    error?.statusText ??
    error ??
    'Unknown MapLibre error'
  );
}

export class MapLibrePmtilesMapAdapter extends MapLibreMapAdapter {
  constructor({
    maplibre = maplibregl,
    createOfflineStyle = createMapLibrePmtilesStyle,
    style = ONLINE_VECTOR_STYLE,
    ...options
  } = {}) {
    super({
      ...options,
      style,
      maplibre,
      createOfflineStyle
    });

    this.currentRoute = null;
    this.currentRouteProgress = null;
    this.currentManeuvers = null;
    this.currentManeuverIndex = 0;
    this.mapSourceMode = 'demo';
    this.routeRenderPending = false;
    this.routeRenderRetryTimer = null;

    this.map.dragPan?.enable?.();
    this.map.scrollZoom?.enable?.();
    this.map.doubleClickZoom?.enable?.();
    this.map.touchZoomRotate?.enable?.();
    this.map.touchPitch?.enable?.();

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

    this.mapErrorElement = document.createElement('div');
    this.mapErrorElement.className = 'atlas-maplibre-runtime-error';
    this.mapErrorElement.hidden = true;
    Object.assign(this.mapErrorElement.style, {
      position: 'absolute',
      zIndex: '2000',
      left: '12px',
      right: '12px',
      top: '225px',
      padding: '9px 11px',
      borderRadius: '10px',
      background: 'rgba(170, 20, 20, 0.94)',
      color: '#fff',
      fontSize: '11px',
      fontWeight: '700',
      lineHeight: '1.25',
      pointerEvents: 'none'
    });
    this.map.getContainer().appendChild(this.mapErrorElement);

    this.map.on('error', event => {
      const message = mapErrorMessage(event);
      console.error('MapLibre runtime error:', event?.error ?? event);
      this.mapErrorElement.textContent =
        `MapLibre error: ${message}`;
      this.mapErrorElement.hidden = false;
    });

    this.map.on('style.load', () => {
      this.mapSourceBadge.textContent = 'Demo style loaded';
      this.#scheduleRouteRender();
    });

    this.map.on('load', () => {
      this.#scheduleRouteRender();
    });
  }

  async setRegion(region, options = {}) {
    void options;

    const mapUrl =
      region?.mapUrl ??
      region?.assets?.map ??
      null;

    // Do not call setStyle here during this diagnostic build. The constructor
    // already owns the official MapLibre demo style, and a region change must
    // not replace it with our still-unverified PMTiles style.
    this.mapSourceMode = 'demo';
    this.#renderMapSourceBadge();
    return Boolean(mapUrl);
  }

  showRoute(route) {
    if (!validRoute(route)) {
      throw new TypeError(
        'showRoute requires at least two valid route points.'
      );
    }

    this.currentRoute = route;
    this.currentRouteProgress = null;
    this.fitRoute(route);
    this.#scheduleRouteRender({ immediate: true });
    return true;
  }

  updateRouteProgress(route, progress) {
    if (validRoute(route)) {
      this.currentRoute = route;
    }

    this.currentRouteProgress = progress ?? null;
    this.navigationRouteProgress = progress ?? null;

    if (!validRoute(this.currentRoute)) {
      return;
    }

    this.routeBearing = bearingFromProgress(
      this.currentRoute.points,
      progress
    );

    this.#scheduleRouteRender({ immediate: true });
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
    this.routeRenderPending = false;

    clearTimeout(this.routeRenderRetryTimer);
    this.routeRenderRetryTimer = null;

    this.#tryRemoveRouteOverlay();
  }

  #scheduleRouteRender({ immediate = false } = {}) {
    if (!validRoute(this.currentRoute)) {
      return;
    }

    if (immediate && this.#tryRenderStoredRoute()) {
      return;
    }

    if (this.routeRenderPending) {
      return;
    }

    this.routeRenderPending = true;

    queueMicrotask(() => {
      this.routeRenderPending = false;

      if (this.#tryRenderStoredRoute()) {
        return;
      }

      clearTimeout(this.routeRenderRetryTimer);
      this.routeRenderRetryTimer = setTimeout(() => {
        this.routeRenderRetryTimer = null;
        this.#tryRenderStoredRoute();
      }, 120);
    });
  }

  #tryRenderStoredRoute() {
    if (!validRoute(this.currentRoute)) {
      return false;
    }

    try {
      const style = this.map.getStyle?.();
      if (!style || !Array.isArray(style.layers)) {
        return false;
      }

      this.#removeRouteOverlay();

      const points = this.currentRoute.points;
      const split = this.currentRouteProgress
        ? splitRoute(points, this.currentRouteProgress)
        : null;

      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: collection([
          lineFeature(split?.remaining ?? points)
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
          'line-width': 12,
          'line-opacity': 0.98
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
          'line-color': '#2563eb',
          'line-width': 7,
          'line-opacity': 1
        }
      });

      if (split) {
        this.map.addSource(TRAVELED_SOURCE, {
          type: 'geojson',
          data: collection([
            lineFeature(split.traveled)
          ])
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
            'line-width': 7,
            'line-opacity': 0.9
          }
        });
      }

      this.#raiseRouteLayers();
      this.map.triggerRepaint?.();
      return Boolean(
        this.map.getLayer?.('atlas-route-remaining')
      );
    } catch (error) {
      const message = mapErrorMessage(error);
      this.mapErrorElement.textContent =
        `Route layer error: ${message}`;
      this.mapErrorElement.hidden = false;
      console.error('Unable to render MapLibre route.', error);
      return false;
    }
  }

  #raiseRouteLayers() {
    for (const layerId of [
      'atlas-route-casing',
      'atlas-route-traveled',
      'atlas-route-remaining'
    ]) {
      if (this.map.getLayer?.(layerId)) {
        this.map.moveLayer?.(layerId);
      }
    }
  }

  #tryRemoveRouteOverlay() {
    try {
      this.#removeRouteOverlay();
    } catch {
      // setStyle() may be between style instances.
    }
  }

  #removeRouteOverlay() {
    for (const layerId of ROUTE_LAYER_IDS) {
      if (this.map.getLayer?.(layerId)) {
        this.map.removeLayer(layerId);
      }
    }

    for (const sourceId of [
      TRAVELED_SOURCE,
      ROUTE_SOURCE
    ]) {
      if (this.map.getSource?.(sourceId)) {
        this.map.removeSource(sourceId);
      }
    }
  }

  #renderMapSourceBadge() {
    if (!this.mapSourceBadge) return;

    this.mapSourceBadge.textContent =
      'MapLibre demo';
    this.mapSourceBadge.dataset.mode = 'online';
    this.mapSourceBadge.title =
      'Official MapLibre demo vector style diagnostic build.';
  }
}
