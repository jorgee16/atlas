const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function navigationLookAheadMeters({ travelMode = 'drive', speed = null, landscape = false, distanceToManeuverMeters = null } = {}) {
  const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (travelMode === 'walk') {
    const base = landscape ? 150 : 130;
    return clamp(Number.isFinite(distanceToManeuverMeters) ? Math.max(base, Math.min(distanceToManeuverMeters + 45, 220)) : base, 120, 220);
  }
  const speedTarget = 260 + speedMps * 10;
  const maneuverTarget = Number.isFinite(distanceToManeuverMeters)
    ? Math.min(Math.max(distanceToManeuverMeters + 90, 260), 720)
    : 0;
  return clamp(Math.max(speedTarget * (landscape ? 1.25 : 1), maneuverTarget), 260, landscape ? 760 : 650);
}

export function fovAdjustedPreferredZoom({ preferredZoom = 18, visibleMeters = 0, targetMeters = 300, minimumZoom = 15.6 } = {}) {
  if (!Number.isFinite(preferredZoom) || !Number.isFinite(visibleMeters) || !Number.isFinite(targetMeters) || visibleMeters <= 0 || targetMeters <= 0) {
    return preferredZoom;
  }
  if (visibleMeters >= targetMeters * 0.82) return preferredZoom;
  return clamp(preferredZoom - Math.log2(targetMeters / visibleMeters), minimumZoom, preferredZoom);
}
