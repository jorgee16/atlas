import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  MapLibreMapAdapter
} from './maplibre-map-adapter.js';
import {
  createMapLibrePmtilesStyle
} from './layers/maplibre-pmtiles-style.js';
import {
  createAtlasMapLibreStyle
} from './atlas-maplibre-style.js';
import {
  installMapLibreZoomControl
} from './maplibre-zoom-control.js';
import {
  installMapLibreTurnHighlight
} from './maplibre-turn-highlight.js';

installMapLibreTurnHighlight(MapLibreMapAdapter);

const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';
const ROUTE_LAYER_IDS = [
  'atlas-route-traveled',
  'atlas-route-remaining',
  'atlas-route-casing'
];

const STATIONARY_SPEED_METERS_PER_SECOND = 0.8;
const CAMERA_POSITION_DEADBAND_METERS = 4;
const CAMERA_HEADING_DEADBAND_DEGREES = 6;

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function bearingDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(((a - b + 540) % 360) - 180);
}

function distanceMeters(a, b) {
  if (
    !Number.isFinite(a?.latitude) ||
    !Number.isFinite(a?.longitude) ||
    !Number.isFinite(b?.latitude) ||
    !Number.isFinite(b?.longitude)
  ) {
    return Infinity;
  }

  const earthRadius = 6371000;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const deltaLat = (b.latitude - a.latitude) * Math.PI / 180;
  const deltaLon = (b.longitude - a.longitude) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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
  return { type: 'FeatureCollection', features };
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

function leafletNavigationCursorHtml({ drive, heading, showHeading }) {
  const rotation = Number.isFinite(heading)
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
    style = createAtlasMapLibreStyle(),
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
    this.routeRenderPending = false;
    this.routeRenderRetryTimer = null;
    this.lastCameraFollowPosition = null;
    this.lastCameraFollowHeading = null;

    this.map.dragPan?.enable?.();
    this.map.scrollZoom?.enable?.();
    this.map.doubleClickZoom?.enable?.();
    this.map.touchZoomRotate?.enable?.();
    this.map.touchPitch?.enable?.();
    this.map.setMaxPitch?.(60);

    this.zoomControlElement = installMapLibreZoomControl(this.map);

    this.map.on('error', event => {
      console.error('MapLibre runtime error:', event?.error ?? event);
    });

    this.map.on('style.load', () => {
      this.#scheduleRouteRender();
    });

    this.map.on('load', () => {
      this.#scheduleRouteRender();
    });

    this.map.on('movestart', event => {
      if (event?.originalEvent) {
        this.lastCameraFollowPosition = null;
        this.lastCameraFollowHeading = null;
      }
    });
  }

  async setRegion(region, options = {}) {
    const mapUrl = region?.mapUrl ?? region?.assets?.map ?? null;

    if (
      options?.preferOffline &&
      mapUrl &&
      typeof this.createOfflineStyle === 'function'
    ) {
      try {
        const loaded = await super.setRegion(region, options);
        if (loaded) return true;
      } catch (error) {
        console.warn(
          'MapLibre offline style failed; continuing with Atlas online vector style.',
          error
        );
      }
    }

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
        zoom: 16,
        duration: 350,
        essential: true
      });
    }
  }

  setNavigationTravelMode(mode = null) {
    const result = super.setNavigationTravelMode(mode);
    this.lastCameraFollowPosition = null;
    this.lastCameraFollowHeading = null;

    if (this.lastUserPosition) {
      this.#restoreLeafletCursor(this.lastUserPosition);
    }

    if (validRoute(this.currentRoute)) {
      this.#scheduleRouteRender({ immediate: true });
    }

    return result;
  }

  followPosition(position, options = {}) {
    const latitude = position?.latitude ?? position?.lat;
    const longitude = position?.longitude ?? position?.lon;
    const speed = Number.isFinite(position?.speed) ? position.speed : 0;
    const heading = Number.isFinite(position?.heading)
      ? normalizeBearing(position.heading)
      : Number.isFinite(this.routeBearing)
        ? normalizeBearing(this.routeBearing)
        : null;

    const nextCameraPosition = {
      latitude,
      longitude
    };

    const stationary = speed < STATIONARY_SPEED_METERS_PER_SECOND;
    const movedMeters = distanceMeters(
      this.lastCameraFollowPosition,
      nextCameraPosition
    );
    const headingChanged = bearingDelta(
      this.lastCameraFollowHeading,
      heading
    );

    if (
      stationary &&
      movedMeters < CAMERA_POSITION_DEADBAND_METERS &&
      headingChanged < CAMERA_HEADING_DEADBAND_DEGREES
    ) {
      return Number.isFinite(this.map.getBearing?.())
        ? normalizeBearing(-this.map.getBearing())
        : 0;
    }

    const result = super.followPosition(position, options);
    this.lastCameraFollowPosition = nextCameraPosition;
    this.lastCameraFollowHeading = heading;
    return result;
  }

  showSelectionPin(lat, lon, popupContent = null) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new TypeError('showSelectionPin requires lat and lon.');
    }

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
      throw new TypeError('showRoute requires at least two valid route points.');
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

    if (!validRoute(this.currentRoute)) return;

    this.routeBearing = bearingFromProgress(this.currentRoute.points, progress);
    this.#scheduleRouteRender({ immediate: true });
  }

  clearRoute() {
    this.currentRoute = null;
    this.currentRouteProgress = null;
    this.routeBearing = null;
    this.navigationRouteProgress = null;
    this.navigationCameraZoom = null;
    this.navigationCameraTimestamp = null;
    this.routeRenderPending = false;
    this.lastCameraFollowPosition = null;
    this.lastCameraFollowHeading = null;

    clearTimeout(this.routeRenderRetryTimer);
    this.routeRenderRetryTimer = null;

    this.clearManeuvers();
    this.#tryRemoveRouteOverlay();
  }

  #restoreLeafletCursor(position) {
    if (!this.userMarkerElement) return;

    const drive = this.navigationTravelMode === 'drive';
    const speed = position?.speed;
    const heading = position?.heading;
    const showHeading =
      Number.isFinite(heading) &&
      Number.isFinite(speed) &&
      speed >= STATIONARY_SPEED_METERS_PER_SECOND;

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
    this.userMarkerElement.innerHTML = leafletNavigationCursorHtml({
      drive,
      heading,
      showHeading
    });
  }

  #scheduleRouteRender({ immediate = false } = {}) {
    if (!validRoute(this.currentRoute)) return;

    if (immediate && this.#tryRenderStoredRoute()) return;
    if (this.routeRenderPending) return;

    this.routeRenderPending = true;

    queueMicrotask(() => {
      this.routeRenderPending = false;

      if (this.#tryRenderStoredRoute()) return;

      clearTimeout(this.routeRenderRetryTimer);
      this.routeRenderRetryTimer = setTimeout(() => {
        this.routeRenderRetryTimer = null;
        this.#tryRenderStoredRoute();
      }, 120);
    });
  }

  #tryRenderStoredRoute() {
    if (!validRoute(this.currentRoute)) return false;

    try {
      const style = this.map.getStyle?.();
      if (!style || !Array.isArray(style.layers)) return false;

      this.#removeRouteOverlay();

      const points = this.currentRoute.points;
      const split = this.currentRouteProgress
        ? splitRoute(points, this.currentRouteProgress)
        : null;
      const walking = this.navigationTravelMode === 'walk';

      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: collection([lineFeature(split?.remaining ?? points)])
      });

      this.map.addLayer({
        id: 'atlas-route-casing',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: walking
          ? {
              'line-color': '#ffffff',
              'line-width': 8,
              'line-opacity': 0.98,
              'line-dasharray': [0.12, 1.45]
            }
          : {
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
        paint: walking
          ? {
              'line-color': '#2563eb',
              'line-width': 5,
              'line-opacity': 1,
              'line-dasharray': [0.12, 2.05]
            }
          : {
              'line-color': '#2563eb',
              'line-width': 7,
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
          paint: walking
            ? {
                'line-color': '#737b8c',
                'line-width': 5,
                'line-opacity': 0.68,
                'line-dasharray': [0.12, 2.05]
              }
            : {
                'line-color': '#737b8c',
                'line-width': 7,
                'line-opacity': 0.9
              }
        });
      }

      this.#raiseRouteLayers();
      if (this.currentManeuvers) {
        this.showManeuvers(
          this.currentManeuvers,
          this.currentManeuverIndex
        );
      }
      this.map.triggerRepaint?.();
      return Boolean(this.map.getLayer?.('atlas-route-remaining'));
    } catch (error) {
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
    }
  }

  #removeRouteOverlay() {
    for (const layerId of ROUTE_LAYER_IDS) {
      if (this.map.getLayer?.(layerId)) {
        this.map.removeLayer(layerId);
      }
    }

    for (const sourceId of [TRAVELED_SOURCE, ROUTE_SOURCE]) {
      if (this.map.getSource?.(sourceId)) {
        this.map.removeSource(sourceId);
      }
    }
  }
}
