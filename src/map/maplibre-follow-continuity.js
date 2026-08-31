import { MapLibreMapAdapter } from './maplibre-map-adapter.js';

const originalFollowPosition = MapLibreMapAdapter.prototype.followPosition;
const originalUpdateUserLocation = MapLibreMapAdapter.prototype.updateUserLocation;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

MapLibreMapAdapter.prototype.followPosition = function patchedFollowPosition(
  position,
  options = {}
) {
  const now = performance.now();
  const previous = this.__atlasFollowFixTimestamp ?? null;
  const interval = previous === null
    ? 900
    : clamp(now - previous, 350, 2000);

  this.__atlasFollowFixTimestamp = now;

  if (this.navigationTravelMode !== 'drive' || !this.map?.easeTo) {
    return originalFollowPosition.call(this, position, options);
  }

  const nativeEaseTo = this.map.easeTo;
  const continuityDuration = clamp(interval * 1.16, 650, 2200);

  this.map.easeTo = cameraOptions => nativeEaseTo.call(
    this.map,
    {
      ...cameraOptions,
      // Keep camera motion alive until just after the next expected GPS fix.
      // Linear motion avoids the ease-out pause that previously made the map
      // appear frozen before every recenter.
      duration: continuityDuration,
      easing: t => t
    }
  );

  try {
    return originalFollowPosition.call(this, position, options);
  } finally {
    this.map.easeTo = nativeEaseTo;
  }
};

MapLibreMapAdapter.prototype.updateUserLocation = function patchedUpdateUserLocation(
  position,
  firstFix = false
) {
  const now = performance.now();
  const previous = this.__atlasMarkerFixTimestamp ?? null;
  const interval = previous === null
    ? 900
    : clamp(now - previous, 350, 2000);

  this.__atlasMarkerFixTimestamp = now;

  const result = originalUpdateUserLocation.call(this, position, firstFix);

  if (
    this.navigationTravelMode === 'drive' &&
    this.userMarkerElement &&
    !firstFix
  ) {
    this.userMarkerElement.style.transition =
      `transform ${Math.round(clamp(interval * 1.1, 600, 1900))}ms linear`;
  }

  return result;
};
