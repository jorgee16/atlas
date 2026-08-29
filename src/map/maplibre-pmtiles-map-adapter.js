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

// Use the OpenFreeMap OpenMapTiles source directly instead of the full
// Liberty style while diagnosing Android/WebView rendering. This removes
// glyphs, sprites and auxiliary raster sources from the equation and leaves a
// small, deterministic vector-only style with the layers Atlas actually needs
// to prove street rendering.
const ONLINE_VECTOR_STYLE = {
  version: 8,
  name: 'Atlas OpenFreeMap diagnostic',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet'
    }
  },
  layers: [
    {
      id: 'atlas-background',
      type: 'background',
      paint: { 'background-color': '#f3f1ec' }
    },
    {
      id: 'atlas-landcover',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'wood', '#dce8d4',
          'grass', '#e5edd8',
          '#e8eadf'
        ],
        'fill-opacity': 0.75
      }
    },
    {
      id: 'atlas-water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#b9dceb' }
    },
    {
      id: 'atlas-buildings',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 12,
      paint: {
        'fill-color': '#d9d5cf',
        'fill-outline-color': '#c8c3bc'
      }
    },
    {
      id: 'atlas-roads-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 5,
      filter: [
        'match',
        ['geometry-type'],
        ['LineString'], true,
        false
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#c8c4be',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 0.7,
          10, 1.8,
          14, 4.8,
          18, 11
        ]
      }
    },
    {
      id: 'atlas-roads',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 5,
      filter: [
        'match',
        ['geometry-type'],
        ['LineString'], true,
        false
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'motorway', '#e3a59d',
          'trunk', '#efc38f',
          'primary', '#f1d8ad',
          'secondary', '#ffffff',
          'tertiary', '#ffffff',
          '#ffffff'
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 0.4,
          10, 1.2,
          14, 3.4,
          18, 8.5
        ]
      }
    }
  ]
};

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

function leafletNavigationCursorHtml({
  drive,
  heading,
  showHeading
}) {
  const rotation =
    Number.isFinite(heading)
      ? normalizeBearing(heading)
      : 0;

  if (drive) {
    return `
      <div style="width:38px;height:38px;display:grid;place-items:center;background:#fff;border-radius:50%;box-shadow:0 2px 9px rgba(0,0,0,.30);transform:rotate(${rotation}deg);transition:transform 220ms ease;">
        <svg width="25" height="25" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.4 20.1 20 12 16.4 3.9 20 12 2.4Z" fill="#2563eb"/>
        </svg>
      </div>`;
  }

  if (showHeading) {
    return `
      <div style="position:relative;width:42px;height:42px;transform:rotate(${rotation}deg);transition:transform 220ms ease;">
        <div style="position:absolute;top:0;left:50%;width:0;height:0;transform:translateX(-50%);border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:22px solid #2563eb;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28));"></div>
        <div style="position:absolute;left:50%;bottom:5px;width:18px;height:18px;transform:translateX(-50%);background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.28);"></div>
      </div>`;
  }

  return `
    <div style="width:20px;height:20px;background:#2563eb;border:4px solid #fff;border-radius:50%;box-shadow:0 2px 9px rgba(0,0,0,.30);"></div>`;
}

function selectionPinElement() {
  const element = document.createElement('div');
  element.style.cssText = [
    'width:30px',
    'height:38px',
    'display:grid',
    'place-items:start center',
    'filter:drop-shadow(0 3px 6px rgba(0,0,0,.28))'
  ].join(';');
  element.innerHTML = `
    <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
      <path d="M15 1.5C7.7 1.5 2 7.1 2 14.2c0 9.3 13 21.9 13 21.9s13-12.6 13-21.9C28 7.1 22.3 1.5 15 1.5Z" fill="#315efb" stroke="#fff" stroke-width="3"/>
      <circle cx="15" cy="14" r="5" fill="#fff"/>
    </svg>`;
  return element;
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

    this.renderDiagnosticsElement =
      document.createElement('div');
    Object.assign(this.renderDiagnosticsElement.style, {
      position: 'absolute',
      zIndex: '1999',
      left: '12px',
      bottom: '118px',
      maxWidth: 'min(420px, calc(100% - 24px))',
      padding: '7px 9px',
      borderRadius: '9px',
      background: 'rgba(20, 28, 42, 0.88)',
      color: '#fff',
      fontSize: '10px',
      fontWeight: '650',
      lineHeight: '1.3',
      whiteSpace: 'pre-wrap',
      pointerEvents: 'none'
    });
    this.renderDiagnosticsElement.textContent =
      'MapLibre diagnostics waiting…';
    this.map.getContainer().appendChild(
      this.renderDiagnosticsElement
    );

    this.map.on('error', event => {
      const message = mapErrorMessage(event);
      console.error('MapLibre runtime error:', event?.error ?? event);
      this.mapErrorElement.textContent =
        `MapLibre error: ${message}`;
      this.mapErrorElement.hidden = false;
      this.#refreshRenderDiagnostics();
    });

    this.map.on('style.load', () => {
      this.mapSourceBadge.textContent = 'OpenFreeMap source loaded';
      this.#scheduleRouteRender();
      this.#refreshRenderDiagnostics();
    });

    this.map.on('load', () => {
      this.#scheduleRouteRender();
      this.#refreshRenderDiagnostics();
    });

    this.map.on('idle', () => {
      this.#refreshRenderDiagnostics();
    });

    this.map.on('moveend', () => {
      this.#refreshRenderDiagnostics();
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

    super.updateUserLocation(position, false);
    this.#restoreLeafletCursor(position);

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

    queueMicrotask(() => {
      this.#refreshRenderDiagnostics();
    });
  }

  setNavigationTravelMode(mode = null) {
    const result = super.setNavigationTravelMode(mode);
    if (this.lastUserPosition) {
      this.#restoreLeafletCursor(this.lastUserPosition);
    }
    return result;
  }

  followPosition(position, options = {}) {
    const result = super.followPosition(position, {
      ...options,
      zoom: Math.min(
        Number.isFinite(options?.zoom)
          ? options.zoom
          : GPS_DIAGNOSTIC_MAX_ZOOM,
        GPS_DIAGNOSTIC_MAX_ZOOM
      )
    });
    this.#refreshRenderDiagnostics();
    return result;
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

  showSelectionPin(lat, lon, popupContent = null) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new TypeError('showSelectionPin requires lat and lon.');
    }

    // Always replace the selection marker. Using one self-contained SVG avoids
    // the old CSS pin plus nested MapLibre shape rendering as two indicators.
    this.selectionPopup?.remove?.();
    this.selectionPopup = null;
    this.selectionMarker?.remove?.();
    this.selectionMarker = new this.maplibre.Marker({
      element: selectionPinElement(),
      anchor: 'bottom'
    })
      .setLngLat([lon, lat])
      .addTo(this.map);

    if (!popupContent) return;

    this.selectionPopup = new this.maplibre.Popup({
      offset: [0, -10],
      maxWidth: '224px',
      closeOnClick: false,
      focusAfterOpen: false
    }).setLngLat([lon, lat]);

    if (typeof popupContent === 'string') {
      this.selectionPopup.setHTML(popupContent);
    } else {
      this.selectionPopup.setDOMContent(popupContent);
    }

    this.selectionPopup.addTo(this.map);
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

  #restoreLeafletCursor(position) {
    if (!this.userMarkerElement) {
      return;
    }

    const drive =
      this.navigationTravelMode === 'drive';
    const speed = position?.speed;
    const heading = position?.heading;
    const showHeading =
      Number.isFinite(heading) &&
      Number.isFinite(speed) &&
      speed >= 0.8;

    this.userMarkerElement.className = '';
    this.userMarkerElement.style.width = drive
      ? '38px'
      : showHeading
        ? '42px'
        : '20px';
    this.userMarkerElement.style.height = drive
      ? '38px'
      : showHeading
        ? '42px'
        : '20px';
    this.userMarkerElement.innerHTML =
      leafletNavigationCursorHtml({
        drive,
        heading,
        showHeading
      });
  }

  #refreshRenderDiagnostics() {
    if (!this.renderDiagnosticsElement) return;

    try {
      const center = this.map.getCenter?.();
      const zoom = this.map.getZoom?.();
      const styleLoaded =
        Boolean(this.map.isStyleLoaded?.());
      const tilesLoaded =
        Boolean(this.map.areTilesLoaded?.());
      const source =
        this.map.getSource?.('openmaptiles');

      let rendered = '—';
      try {
        rendered = String(
          this.map.queryRenderedFeatures?.().length ?? '—'
        );
      } catch {
        rendered = 'err';
      }

      const sourceState = source
        ? source.constructor?.name ?? 'present'
        : 'missing';

      this.renderDiagnosticsElement.textContent = [
        `center ${Number(center?.lat).toFixed(4)}, ${Number(center?.lng).toFixed(4)}  z${Number(zoom).toFixed(2)}`,
        `style ${styleLoaded ? 'ready' : 'loading'}  tiles ${tilesLoaded ? 'ready' : 'loading'}`,
        `openmaptiles ${sourceState}  rendered ${rendered}`
      ].join('\n');
    } catch (error) {
      this.renderDiagnosticsElement.textContent =
        `diagnostics error: ${mapErrorMessage(error)}`;
    }
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
      'OpenFreeMap vector source';
    this.mapSourceBadge.dataset.mode = 'online';
    this.mapSourceBadge.title =
      'Direct OpenFreeMap OpenMapTiles source diagnostic.';
  }
}
