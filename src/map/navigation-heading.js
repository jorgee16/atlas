const DEFAULT_ROUTE_WEIGHT = 0.68;
const MIN_ROUTE_WEIGHT = 0.12;
const MAX_ROUTE_WEIGHT = 0.96;

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
  routeHeading,
  gpsOverrideAllowed = false
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

  const routeDistance =
    Number.isFinite(distanceFromRouteMeters)
      ? Math.max(0, distanceFromRouteMeters)
      : 0;

  const routeCorridor = Math.max(
    60,
    Number.isFinite(accuracy)
      ? accuracy * 1.8
      : 0
  );

  // While the car still sits inside the planned-road corridor, keep the
  // navigation camera tied strongly to route geometry. Android GPS course can
  // briefly flip or lag after ramps, roundabouts and slow motorway sections;
  // one bad heading sample must never rotate the map backwards.
  if (!gpsOverrideAllowed && routeDistance <= routeCorridor) {
    const speedProgress = clamp(
      (speedMetersPerSecond - 4) / 18,
      0,
      1
    );

    return clamp(
      0.94 - speedProgress * 0.04,
      0.88,
      MAX_ROUTE_WEIGHT
    );
  }

  // Once the adapter has confirmed a sustained deviation, progressively hand
  // camera authority back to GPS so Atlas can follow a genuine wrong exit or
  // opposite-direction movement rather than visually forcing the old route.
  const speedProgress = clamp(
    (speedMetersPerSecond - 3) / 12,
    0,
    1
  );

  let routeWeight =
    0.72 - speedProgress * 0.20;

  if (Number.isFinite(accuracy)) {
    if (accuracy <= 12) {
      routeWeight -= 0.05;
    } else if (accuracy >= 25) {
      routeWeight += 0.05;
    }
  }

  const deviationProgress = clamp(
    (routeDistance - routeCorridor * 0.65) /
      (routeCorridor * 0.75),
    0,
    1
  );

  routeWeight *=
    1 - deviationProgress * 0.82;

  const disagreement = Math.abs(
    headingDelta(gpsHeading, routeHeading)
  );

  const gpsDirectionReliable =
    speedMetersPerSecond >= 4 &&
    (!Number.isFinite(accuracy) || accuracy <= 35);

  if (gpsOverrideAllowed && gpsDirectionReliable && disagreement > 45) {
    const disagreementProgress = clamp(
      (disagreement - 45) / 80,
      0,
      1
    );

    routeWeight *=
      1 - disagreementProgress * 0.68;
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
  distanceFromRouteMeters,
  gpsOverrideAllowed = false
} = {}) {
  const routeWeight = carRouteHeadingWeight({
    speed,
    accuracy,
    distanceFromRouteMeters,
    gpsHeading,
    routeHeading,
    gpsOverrideAllowed
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
