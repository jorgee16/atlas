import {
  MapLibreMapAdapter
} from './maplibre-map-adapter.js';
import { createMapLibrePmtilesStyle } from './layers/maplibre-pmtiles-style.js';

const STATIONARY_SPEED_METERS_PER_SECOND = 0.8;
const CAMERA_POSITION_DEADBAND_METERS = 3;
const CAMERA_HEADING_DEADBAND_DEGREES = 4;

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

function selectionPinElement() {
  const element = document.createElement('div');
  element.className = 'maplibre-selection-pin';
  return element;
}

export class MapLibrePmtilesMapAdapter extends MapLibreMapAdapter {
  constructor(options = {}) {
    super(options);

    this.currentRoute = null;
    this.currentRouteProgress = null;
    this.routeBearing = null;
    this.navigationRouteProgress = null;
    this.navigationTravelMode = null;
    this.routeRenderPending = false;
    this.routeRenderRetryTimer = null;
    this.selectionMarker = null;
    this.selectionPopup = null;
    this.lastCameraFollowPosition = null;
    this.lastCameraFollowHeading = null;
    this.lastCameraFollowHeadingUp = undefined;
  }

  createOfflineStyle({ pmtilesUrl }) {
    return createMapLibrePmtilesStyle({ pmtilesUrl });
  }

  async setRegion(region, options = {}) {
    const mapUrl =
      region?.map?.url ??
      region?.mapUrl ??
      region?.pmtilesUrl ??
      null;

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
    this.lastCameraFollowHeadingUp = undefined;

    if (this.lastUserPosition) {
      this.#restoreLeafletCursor(this.lastUserPosition);
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
    const headingUp = options?.headingUp === true;

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
    const headingModeChanged =
      typeof this.lastCameraFollowHeadingUp !== 'boolean' ||
      this.lastCameraFollowHeadingUp !== headingUp;

    // GPS deadband must never suppress a navigation camera-state transition.
    // Starting navigation while Follow is already enabled changes the desired
    // zoom/pitch/offset, and the north-up/heading-up button changes bearing.
    // Both must be applied immediately even when speed is zero and the GPS
    // coordinates are identical to the previous fix.
    if (
      !headingModeChanged &&
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
    this.lastCameraFollowHeadingUp = headingUp;
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
    this.lastCameraFollowHeadingUp = undefined;

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
    this.userMarkerElement.classList.add('maplibre-user-marker');
    this.userMarkerElement.classList.toggle(
      'maplibre-user-marker--drive',
      drive
    );
    this.userMarkerElement.classList.toggle(
      'maplibre-user-marker--heading',
      showHeading
    );
    this.userMarkerElement.style.setProperty(
      '--atlas-user-heading',
      `${Number.isFinite(heading) ? normalizeBearing(heading) : 0}deg`
    );
  }

  fitRoute(route) {
    const points = route?.points ?? [];
    if (points.length < 2) return;

    const bounds = new this.maplibre.LngLatBounds();
    for (const point of points) {
      bounds.extend([point.lon, point.lat]);
    }

    this.map.fitBounds(bounds, {
      padding: 72,
      duration: 350,
      maxZoom: 16
    });
  }

  #scheduleRouteRender({ immediate = false } = {}) {
    if (!validRoute(this.currentRoute)) return;

    if (immediate) {
      this.#tryRenderRoute();
      return;
    }

    if (this.routeRenderPending) return;
    this.routeRenderPending = true;

    requestAnimationFrame(() => {
      this.routeRenderPending = false;
      this.#tryRenderRoute();
    });
  }

  #tryRenderRoute() {
    if (!validRoute(this.currentRoute)) return false;

    try {
      const split = splitRoute(
        this.currentRoute.points,
        this.currentRouteProgress
      );
      const routeSource = this.map.getSource?.('atlas-route');
      const traveledSource = this.map.getSource?.('atlas-route-traveled');

      if (routeSource?.setData) {
        routeSource.setData(collection([lineFeature(split.remaining)]));
      }
      if (traveledSource?.setData) {
        traveledSource.setData(collection([lineFeature(split.traveled)]));
      }

      return true;
    } catch (error) {
      console.warn('Unable to render MapLibre route.', error);
      return false;
    }
  }

  #tryRemoveRouteOverlay() {
    try {
      for (const layerId of [
        'atlas-route-remaining',
        'atlas-route-traveled',
        'atlas-route-casing'
      ]) {
        if (this.map.getLayer?.(layerId)) {
          this.map.removeLayer(layerId);
        }
      }

      for (const sourceId of ['atlas-route', 'atlas-route-traveled']) {
        if (this.map.getSource?.(sourceId)) {
          this.map.removeSource(sourceId);
        }
      }
    } catch {
      // Style swaps can remove route layers first.
    }
  }
}
