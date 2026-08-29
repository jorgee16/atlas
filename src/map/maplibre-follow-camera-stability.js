import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const STATIONARY_SPEED_METERS_PER_SECOND = 0.8;
const WALKING_POSITION_DEADBAND_METERS = 5;
const DRIVING_POSITION_DEADBAND_METERS = 8;
const WALKING_HEADING_DEADBAND_DEGREES = 10;
const DRIVING_HEADING_DEADBAND_DEGREES = 7;
const RECENTER_SCREEN_MARGIN_RATIO = 0.22;

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

    // Waze-like behaviour: the rendered user marker may continue moving
    // smoothly, but the camera does not chase every GPS fix or small heading
    // correction. Recenter only after meaningful movement, meaningful heading
    // change, or when the user approaches the screen edge. A direct compass
    // toggle is different: north-up <-> heading-up must always be applied
    // immediately, even if the user has not moved.
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

    const result = originalFollowPosition.call(this, position, options);
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
