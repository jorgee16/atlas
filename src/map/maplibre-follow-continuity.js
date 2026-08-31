import { MapLibreMapAdapter } from './maplibre-map-adapter.js';

const originalFollowPosition = MapLibreMapAdapter.prototype.followPosition;

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
