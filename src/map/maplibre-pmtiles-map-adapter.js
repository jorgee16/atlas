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

const ONLINE_VECTOR_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

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

    // Explicitly enable the native MapLibre gesture handlers. On Android the
    // map must behave like a real touch map: one-finger pan, pinch zoom,
    // two-finger rotate and two-finger pitch. The +/- buttons are optional.
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

    // A setStyle() removes every application-owned source/layer. Restore the
    // active route whenever a style becomes mutation-ready.
    this.map.on('style.load', () => {
      this.#scheduleRouteRender();
    });

    this.map.on('load', () => {
      this.#scheduleRouteRender();
    });
  }

  async setRegion(region, options = {}) {
    const mapUrl =
      region?.mapUrl ??
      region?.assets?.map ??
      null;

    /*
     * IMPORTANT DURING THE MAPLIBRE MIGRATION:
     *
     * The existing Atlas PMTiles archive was packaged for the Leaflet vector
     * layer and its source-layer schema does not yet match the provisional
     * MapLibre PMTiles style. Loading that style produces exactly the blank
     * beige map seen on Android: the background layer renders, but the road,
     * place and building source-layers do not.
     *
     * Keep MapLibre on the known-good online vector style until the PMTiles
     * schema/style pair is rebuilt and verified. Offline search/routing remain
     * independent from this renderer choice.
     */
    void options;

    this.mapSourceMode = 'online';
    this.#renderMapSourceBadge();

    const currentStyle = this.map.getStyle?.();
    const currentStyleName = currentStyle?.name ?? '';

    // Avoid unnecessary setStyle() calls because each one destroys the route
    // overlay and reloads the vector style.
    if (!/liberty/i.test(currentStyleName)) {
      this.map.setStyle(ONLINE_VECTOR_STYLE);
    }

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

    // Fit first so a successful route calculation is immediately obvious to
    // the user even before the style mutation occurs.
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

      // If showRoute() arrived during setStyle(), style.load will normally
      // render it. This short retry also covers WebView timing where the style
      // event has just fired but source mutation is not accepted until the
      // following frame.
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
      // "Style is not done loading" is expected only during a style swap.
      // Keep the route in memory and let style.load/retry render it.
      const message = String(error?.message ?? error);
      if (!/style|source|layer/i.test(message)) {
        console.error('Unable to render MapLibre route.', error);
      }
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
      // setStyle() may be between style instances; there is nothing useful to
      // remove in that interval because MapLibre discards old custom layers.
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

    const offline =
      this.mapSourceMode === 'offline';

    this.mapSourceBadge.textContent =
      offline ? 'Offline vector' : 'Online vector';
    this.mapSourceBadge.dataset.mode =
      offline ? 'offline' : 'online';
    this.mapSourceBadge.title =
      offline
        ? 'Atlas is using the downloaded regional vector map.'
        : 'Atlas is using an online MapLibre vector style.';
  }
}
