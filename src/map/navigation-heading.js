const DEFAULT_ROUTE_WEIGHT = 0.68;
const MIN_ROUTE_WEIGHT = 0.12;
const MAX_ROUTE_WEIGHT = 0.84;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeHeading(value) {
  return ((Number(value) % 360) + 360) % 360;
}

export function headingDelta(from, to) {
  const delta = normalizeHeading(to) - normalizeHeading(from);
  return ((delta + 540) % 360) - 180;
}

export function blendHeadings(
  gpsHeading,
  routeHeading,
  routeWeight = DEFAULT_ROUTE_WEIGHT
) {
  const gpsValid = Number.isFinite(gpsHeading);
  const routeValid = Number.isFinite(routeHeading);

  if (!gpsValid && !routeValid) {
    return null;
  }

  if (!gpsValid) {
    return normalizeHeading(routeHeading);
  }

  if (!routeValid) {
    return normalizeHeading(gpsHeading);
  }

  const weight = clamp(routeWeight, 0, 1);

  return normalizeHeading(
    gpsHeading +
      headingDelta(gpsHeading, routeHeading) *
        weight
  );
}

export function carRouteHeadingWeight({
  speed,
  accuracy,
  distanceFromRouteMeters,
  gpsHeading,
  routeHeading
} = {}) {
  if (!Number.isFinite(routeHeading)) {
    return 0;
  }

  if (!Number.isFinite(gpsHeading)) {
    return 1;
  }

  const speedMetersPerSecond =
    Number.isFinite(speed)
      ? Math.max(0, speed)
      : 0;

  // At low car speeds GPS course is often noisy, so the route should
  // dominate. At normal/high road speeds the GPS course becomes more
  // trustworthy and receives more authority.
  const speedProgress = clamp(
    (speedMetersPerSecond - 3) / 12,
    0,
    1
  );

  let routeWeight =
    0.78 - speedProgress * 0.18;

  if (Number.isFinite(accuracy)) {
    if (accuracy <= 12) {
      routeWeight -= 0.04;
    } else if (accuracy >= 25) {
      routeWeight += 0.06;
    }
  }

  const routeDistance =
    Number.isFinite(distanceFromRouteMeters)
      ? Math.max(0, distanceFromRouteMeters)
      : 0;

  const routeCorridor = Math.max(
    50,
    Number.isFinite(accuracy)
      ? accuracy * 1.5
      : 0
  );

  // As the vehicle moves toward or beyond the reroute corridor, stop
  // visually forcing the camera down the planned road. This lets GPS
  // course take over quickly during a real deviation.
  const deviationProgress = clamp(
    (routeDistance - routeCorridor * 0.45) /
      (routeCorridor * 0.7),
    0,
    1
  );

  routeWeight *=
    1 - deviationProgress * 0.78;

  // A large, sustained direction disagreement is another useful signal
  // that the car may have turned away from the route. Only trust this
  // signal once the vehicle is moving and GPS accuracy is usable.
  const disagreement = Math.abs(
    headingDelta(gpsHeading, routeHeading)
  );

  const gpsDirectionReliable =
    speedMetersPerSecond >= 4 &&
    (!Number.isFinite(accuracy) || accuracy <= 35);

  if (gpsDirectionReliable && disagreement > 35) {
    const disagreementProgress = clamp(
      (disagreement - 35) / 70,
      0,
      1
    );

    routeWeight *=
      1 - disagreementProgress * 0.55;
  }

  return clamp(
    routeWeight,
    MIN_ROUTE_WEIGHT,
    MAX_ROUTE_WEIGHT
  );
}

export function carNavigationHeading({
  gpsHeading,
  routeHeading,
  speed,
  accuracy,
  distanceFromRouteMeters
} = {}) {
  const routeWeight = carRouteHeadingWeight({
    speed,
    accuracy,
    distanceFromRouteMeters,
    gpsHeading,
    routeHeading
  });

  return blendHeadings(
    gpsHeading,
    routeHeading,
    routeWeight
  );
}

export function smoothHeading(
  currentHeading,
  targetHeading,
  amount
) {
  if (!Number.isFinite(targetHeading)) {
    return Number.isFinite(currentHeading)
      ? normalizeHeading(currentHeading)
      : null;
  }

  if (!Number.isFinite(currentHeading)) {
    return normalizeHeading(targetHeading);
  }

  const interpolation = clamp(amount, 0, 1);

  return normalizeHeading(
    currentHeading +
      headingDelta(
        currentHeading,
        targetHeading
      ) * interpolation
  );
}
