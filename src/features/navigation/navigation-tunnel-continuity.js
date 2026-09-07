import { NavigationFeature } from './navigation-feature.js';

const EARTH_RADIUS_METERS = 6371000;
const GPS_STALE_AFTER_MS = 2500;
const MAX_PREDICTION_MS = 45000;
const PREDICTION_TICK_MS = 1000;
const MIN_DRIVE_PREDICTION_SPEED_METERS_PER_SECOND = 1.5;
const PREDICTED_ACCURACY_METERS = 120;

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function distanceMeters(a, b) {
  if (!validPoint(a) || !validPoint(b)) return 0;

  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  );
}

function bearingBetween(a, b) {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function clampProgress(points, progress = {}) {
  const segmentIndex = Math.max(
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

  return {
    segmentIndex,
    segmentFraction: Number.isFinite(progress?.segmentFraction)
      ? Math.max(0, Math.min(1, progress.segmentFraction))
      : 0
  };
}

export function predictRoutePosition(route, progress, advanceMeters) {
  const points = route?.points ?? [];
  if (
    points.length < 2 ||
    !points.every(validPoint) ||
    !Number.isFinite(advanceMeters) ||
    advanceMeters < 0
  ) {
    return null;
  }

  let { segmentIndex, segmentFraction } = clampProgress(points, progress);
  let remainingAdvance = advanceMeters;

  while (segmentIndex < points.length - 1) {
    const from = points[segmentIndex];
    const to = points[segmentIndex + 1];
    const segmentMeters = distanceMeters(from, to);

    if (segmentMeters <= 0.01) {
      segmentIndex += 1;
      segmentFraction = 0;
      continue;
    }

    const remainingSegmentMeters = segmentMeters * (1 - segmentFraction);

    if (remainingAdvance <= remainingSegmentMeters) {
      const nextFraction = Math.max(
        0,
        Math.min(
          1,
          segmentFraction + remainingAdvance / segmentMeters
        )
      );

      return {
        lat: from.lat + (to.lat - from.lat) * nextFraction,
        lon: from.lon + (to.lon - from.lon) * nextFraction,
        heading: bearingBetween(from, to),
        segmentIndex,
        segmentFraction: nextFraction
      };
    }

    remainingAdvance -= remainingSegmentMeters;
    segmentIndex += 1;
    segmentFraction = 0;
  }

  const lastIndex = points.length - 1;
  const previous = points[lastIndex - 1];
  const last = points[lastIndex];

  return {
    lat: last.lat,
    lon: last.lon,
    heading: bearingBetween(previous, last),
    segmentIndex: lastIndex - 1,
    segmentFraction: 1
  };
}

function ensurePredictionTimer(feature) {
  if (
    feature.__atlasTunnelPredictionTimer ||
    typeof globalThis.window === 'undefined' ||
    typeof globalThis.setInterval !== 'function'
  ) {
    return;
  }

  feature.__atlasTunnelPredictionTimer = globalThis.setInterval(() => {
    const now = feature.now();
    const elapsed = now - (feature.__atlasLastRealNavigationFixAt ?? now);

    if (
      !feature.session?.isActive?.() ||
      !feature.trackPosition ||
      feature.travelMode !== 'drive' ||
      feature.arrivalState ||
      elapsed < GPS_STALE_AFTER_MS ||
      elapsed > MAX_PREDICTION_MS
    ) {
      return;
    }

    const { route } = feature.session.getState();
    const baselineProgress = feature.__atlasTunnelBaselineProgress;
    const speed = feature.__atlasTunnelBaselineSpeed ?? 0;

    if (
      !route ||
      !baselineProgress ||
      speed < MIN_DRIVE_PREDICTION_SPEED_METERS_PER_SECOND
    ) {
      return;
    }

    const predicted = predictRoutePosition(
      route,
      baselineProgress,
      speed * elapsed / 1000
    );

    if (!predicted) return;

    if (!feature.__atlasTunnelPredictionActive) {
      feature.__atlasTunnelPredictionActive = true;
      feature.status?.(
        'GPS signal lost',
        'Estimating your position along the current route.'
      );
    }

    feature.updatePosition({
      name: 'Estimated position',
      lat: predicted.lat,
      lon: predicted.lon,
      heading: predicted.heading,
      speed,
      accuracy: Math.max(
        PREDICTED_ACCURACY_METERS,
        feature.__atlasTunnelBaselineAccuracy ?? 0
      ),
      __atlasPredictedFix: true
    });
  }, PREDICTION_TICK_MS);
}

function clearPredictionTimer(feature) {
  if (feature.__atlasTunnelPredictionTimer) {
    globalThis.clearInterval?.(feature.__atlasTunnelPredictionTimer);
  }

  feature.__atlasTunnelPredictionTimer = null;
  feature.__atlasTunnelPredictionActive = false;
  feature.__atlasTunnelBaselineProgress = null;
}

export function installNavigationTunnelContinuity() {
  const prototype = NavigationFeature?.prototype;
  if (!prototype || prototype.__atlasTunnelContinuityInstalled) return;

  const originalStart = prototype.start;
  const originalStop = prototype.stop;
  const originalUpdatePosition = prototype.updatePosition;

  Object.defineProperty(
    prototype,
    '__atlasTunnelContinuityInstalled',
    { value: true }
  );

  prototype.start = async function startWithTunnelContinuity(...args) {
    const result = await originalStart.apply(this, args);
    ensurePredictionTimer(this);
    return result;
  };

  prototype.stop = function stopWithTunnelContinuity(...args) {
    clearPredictionTimer(this);
    this.__atlasLastRealNavigationFixAt = null;
    this.__atlasTunnelBaselineSpeed = 0;
    this.__atlasTunnelBaselineAccuracy = null;
    return originalStop.apply(this, args);
  };

  prototype.updatePosition = function updatePositionWithTunnelContinuity(position) {
    const predicted = position?.__atlasPredictedFix === true;
    const wasPredicting = this.__atlasTunnelPredictionActive === true;

    const result = originalUpdatePosition.call(this, position);

    if (predicted) {
      return result;
    }

    if (this.session?.isActive?.() && this.trackPosition) {
      this.__atlasLastRealNavigationFixAt = this.now();
      this.__atlasTunnelBaselineSpeed =
        Number.isFinite(position?.speed) && position.speed >= 0
          ? position.speed
          : 0;
      this.__atlasTunnelBaselineAccuracy = Number.isFinite(position?.accuracy)
        ? position.accuracy
        : null;
      this.__atlasTunnelBaselineProgress = this.routeProgress
        ? {
            pointIndex: this.routeProgress.pointIndex,
            segmentIndex: this.routeProgress.segmentIndex,
            segmentFraction: this.routeProgress.segmentFraction
          }
        : null;

      ensurePredictionTimer(this);
    }

    if (wasPredicting) {
      this.__atlasTunnelPredictionActive = false;
      this.status?.(
        'GPS restored',
        'Position confirmed.'
      );
    }

    return result;
  };
}
