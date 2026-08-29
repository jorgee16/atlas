import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';
import {
  fovAdjustedPreferredZoom,
  navigationLookAheadMeters
} from './navigation-fov.js';

const STATIONARY_SPEED_METERS_PER_SECOND = 0.8;
const WALKING_POSITION_DEADBAND_METERS = 5;
const DRIVING_POSITION_DEADBAND_METERS = 8;
const WALKING_HEADING_DEADBAND_DEGREES = 10;
const DRIVING_HEADING_DEADBAND_DEGREES = 7;
const RECENTER_SCREEN_MARGIN_RATIO = 0.22;
const WEB_MERCATOR_CIRCUMFERENCE_METERS = 40075016.686;

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

function viewportState(adapter, latitude) {
  const container = adapter?.map?.getContainer?.();
  const width = Number(container?.clientWidth) || 0;
  const height = Number(container?.clientHeight) || 0;
  const landscape = width > height && width > 0 && height > 0;
  const zoom = Number(adapter?.map?.getZoom?.());

  if (!width || !height || !Number.isFinite(zoom)) {
    return { landscape, visibleMeters: 0 };
  }

  const metersPerPixel =
    WEB_MERCATOR_CIRCUMFERENCE_METERS *
    Math.max(0.1, Math.cos(latitude * Math.PI / 180)) /
    (512 * Math.pow(2, zoom));

  // Only count the useful forward map area. Guidance consumes the top and the
  // journey summary consumes the bottom; landscape has less vertical space.
  const usableForwardPixels = height * (landscape ? 0.44 : 0.56);

  return {
    landscape,
    visibleMeters: usableForwardPixels * metersPerPixel
  };
}

function fovOptions(adapter, position, options) {
  if (!adapter.navigationTravelMode) return options;

  const latitude = position?.latitude ?? position?.lat;
  if (!Number.isFinite(latitude)) return options;

  const viewport = viewportState(adapter, latitude);
  const preferredZoom = Number.isFinite(options?.zoom) ? options.zoom : 18;
  const targetMeters = navigationLookAheadMeters({
    travelMode: adapter.navigationTravelMode,
    speed: position?.speed,
    landscape: viewport.landscape,
    distanceToManeuverMeters:
      adapter.navigationRouteProgress?.distanceToManeuverMeters
  });

  return {
    ...options,
    zoom: fovAdjustedPreferredZoom({
      preferredZoom,
      visibleMeters: viewport.visibleMeters,
      targetMeters,
      minimumZoom: adapter.navigationTravelMode === 'walk' ? 16.2 : 15.6
    })
  };
}

function shouldRecenterForScreen(adapter, position) {
  const map = adapter?.map;
  if (!map?.project || !map?.getContainer) return true;

  const longitude = position?.longitude ?? position?.lon;
  const latitude = position?.latitude ?? position?.lat;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;

  try {
    const point = map.project([longitude, latitude]);
    const container = map.getContainer();
    const width = Number(container?.clientWidth) || 0;
    const height = Number(container?.clientHeight) || 0;
    if (!width || !height) return true;

    const marginX = width * RECENTER_SCREEN_MARGIN_RATIO;
    const marginY = height * RECENTER_SCREEN_MARGIN_RATIO;

    return (
      point.x < marginX ||
      point.x > width - marginX ||
      point.y < marginY ||
      point.y > height - marginY
    );
  } catch {
    return true;
  }
}

export function installMapLibreFollowCameraStability() {
  const prototype = MapLibrePmtilesMapAdapter?.prototype;
  if (!prototype || prototype.__atlasStableFollowCameraInstalled) {
    return;
  }

  const originalFollowPosition = prototype.followPosition;

  Object.defineProperty(
    prototype,
    '__atlasStableFollowCameraInstalled',
    { value: true }
  );

  prototype.followPosition = function followPosition(position, options = {}) {
    const latitude = position?.latitude ?? position?.lat;
    const longitude = position?.longitude ?? position?.lon;
    const speed = Number.isFinite(position?.speed) ? position.speed : 0;
    const heading = Number.isFinite(position?.heading)
      ? normalizeBearing(position.heading)
      : Number.isFinite(this.routeBearing)
        ? normalizeBearing(this.routeBearing)
        : null;
    const headingUp = options?.headingUp === true;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return originalFollowPosition.call(this, position, options);
    }

    this.__atlasLastFollowOptions = options;

    if (!this.__atlasFovResizeBound) {
      this.__atlasFovResizeBound = true;
      this.map?.on?.('resize', () => {
        this.__atlasStableCameraPosition = null;
        if (this.lastUserPosition && this.navigationTravelMode) {
          this.followPosition(
            this.lastUserPosition,
            this.__atlasLastFollowOptions ?? options
          );
        }
      });
    }

    const nextPosition = { latitude, longitude };
    const previousPosition = this.__atlasStableCameraPosition ?? null;
    const previousHeading = this.__atlasStableCameraHeading ?? null;
    const previousHeadingUp = this.__atlasStableCameraHeadingUp;
    const mode = this.navigationTravelMode;
    const stationary = speed < STATIONARY_SPEED_METERS_PER_SECOND;

    const positionDeadband = mode === 'drive'
      ? DRIVING_POSITION_DEADBAND_METERS
      : WALKING_POSITION_DEADBAND_METERS;
    const headingDeadband = mode === 'drive'
      ? DRIVING_HEADING_DEADBAND_DEGREES
      : WALKING_HEADING_DEADBAND_DEGREES;

    const movedMeters = distanceMeters(previousPosition, nextPosition);
    const headingChanged = bearingDelta(previousHeading, heading);
    const outsideComfortArea = shouldRecenterForScreen(this, position);
    const headingModeChanged =
      typeof previousHeadingUp !== 'boolean' ||
      previousHeadingUp !== headingUp;

    const shouldUpdateCamera =
      !previousPosition ||
      headingModeChanged ||
      outsideComfortArea ||
      movedMeters >= positionDeadband ||
      (
        headingUp &&
        !stationary &&
        Number.isFinite(heading) &&
        headingChanged >= headingDeadband
      );

    if (!shouldUpdateCamera) {
      return Number.isFinite(this.map?.getBearing?.())
        ? normalizeBearing(-this.map.getBearing())
        : 0;
    }

    const result = originalFollowPosition.call(
      this,
      position,
      fovOptions(this, position, options)
    );
    this.__atlasStableCameraPosition = nextPosition;
    this.__atlasStableCameraHeadingUp = headingUp;
    if (Number.isFinite(heading)) {
      this.__atlasStableCameraHeading = heading;
    }

    return result;
  };

  const originalSetNavigationTravelMode = prototype.setNavigationTravelMode;
  prototype.setNavigationTravelMode = function setNavigationTravelMode(mode = null) {
    this.__atlasStableCameraPosition = null;
    this.__atlasStableCameraHeading = null;
    this.__atlasStableCameraHeadingUp = undefined;
    return originalSetNavigationTravelMode.call(this, mode);
  };
}
