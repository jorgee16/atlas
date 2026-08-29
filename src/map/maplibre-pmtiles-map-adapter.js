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

// Verified against both OpenFreeMap's quick start and MapLibre's own examples.
// This is a full street-level vector style suitable for zoomed-in navigation.
const ONLINE_VECTOR_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

// Diagnostic ceiling while isolating the Android/WebView high-zoom failure.
// OpenFreeMap renders street detail well below this level, so GPS should still
// be useful while we prove whether the blank map is caused specifically by the
// previous 16-18 zoom jump rather than by coordinates or style loading.
const GPS_DIAGNOSTIC_MAX_ZOOM = 14;

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
    this.mapSourceMode = 'online';
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
      this.mapSourceBadge.textContent = 'OpenFreeMap loaded';
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

    this.mapSourceMode = 'online';
    this.#renderMapSourceBadge();
    return Boolean(mapUrl);
  }

  updateUserLocation(position, firstFix = false) {
    const latitude = position?.latitude;
    const longitude = position?.longitude;

    // Let the base adapter own the marker, but prevent its hard-coded zoom 16
    // first-fix jump. We perform the diagnostic first-fix camera ourselves.
    super.updateUserLocation(position, false);

    if (
      firstFix &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      this.map.easeTo({
        center: [longitude, latitude],
        zoom: GPS_DIAGNOSTIC_MAX_ZOOM,
        duration: 350,
        essential: true
      });

      this.mapSourceBadge.textContent =
        `GPS ${latitude.toFixed(4)}, ${longitude.toFixed(4)} · z${GPS_DIAGNOSTIC_MAX_ZOOM}`;
    }
  }

  followPosition(position, options = {}) {
    return super.followPosition(position, {
      ...options,
      zoom: Math.min(
        Number.isFinite(options?.zoom)
          ? options.zoom
          : GPS_DIAGNOSTIC_MAX_ZOOM,
        GPS_DIAGNOSTIC_MAX_ZOOM
      )
    });
  }

  fitRoute(route, options = {}) {
    return super.fitRoute(route, {
      ...options,
      maxZoom: Math.min(
        Number.isFinite(options?.maxZoom)
          ? options.maxZoom
          : GPS_DIAGNOSTIC_MAX_ZOOM,
        GPS_DIAGNOSTIC_MAX_ZOOM
      )
    });
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
      'OpenFreeMap vector';
    this.mapSourceBadge.dataset.mode = 'online';
    this.mapSourceBadge.title =
      'Verified OpenFreeMap Liberty vector street style.';
  }
}
