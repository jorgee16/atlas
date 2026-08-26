const ROAD_CLASS_SPEED_CAP_KMH = Object.freeze({
  1: 110, // motorway
  2: 90,  // trunk
  3: 55,  // primary
  4: 50,  // secondary
  5: 45,  // tertiary
  6: 28,  // residential
  7: 18,  // service
  8: 12,  // track
  9: 35   // other / unclassified
});

const LONG_ROUTE_SPEED_CAP_KMH = Object.freeze({
  ...ROAD_CLASS_SPEED_CAP_KMH,
  3: 65,
  4: 60,
  5: 50,
  9: 40
});

function speedCapMetersPerSecond(roadClass, distanceMeters) {
  const caps = distanceMeters <= 15_000
    ? ROAD_CLASS_SPEED_CAP_KMH
    : LONG_ROUTE_SPEED_CAP_KMH;

  return (caps[roadClass] ?? 35) / 3.6;
}

function transitionDelaySeconds(previous, current) {
  if (!previous || previous.roadIndex === current.roadIndex) {
    return 0;
  }

  if (current.road?.roundabout || previous.road?.roundabout) {
    return 7;
  }

  const fastestClass = Math.min(
    Number(previous.roadClass ?? 9),
    Number(current.roadClass ?? 9)
  );

  if (fastestClass <= 2) return 2;
  if (fastestClass <= 4) return 4;
  return 6;
}

/**
 * Convert graph free-flow durations into a conservative real-world drive ETA.
 * This deliberately does not alter the path chosen by A*: it only models the
 * fact that a car cannot sustain the posted/default speed continuously through
 * short urban routes, road changes and junctions.
 */
export function calibrateDriveEta(route) {
  if (!route || !Array.isArray(route.legs) || !route.legs.length) {
    return route;
  }

  const totalDistance = Number(route.distanceMeters ?? 0);
  let elapsed = 0;
  let previous = null;

  const calibratedLegs = route.legs.map((leg, index) => {
    const distance = Math.max(0, Number(leg.distanceMeters ?? 0));
    const freeFlow = Math.max(0, Number(leg.durationSeconds ?? 0));
    const cap = speedCapMetersPerSecond(leg.roadClass, totalDistance);
    const capped = cap > 0 ? distance / cap : freeFlow;
    const transition = transitionDelaySeconds(previous, leg);

    // A short route has unavoidable pull-away / arrival overhead that a pure
    // edge-speed sum does not model. Keep it small and bounded.
    const endpointDelay = totalDistance <= 15_000
      ? (index === 0 ? 10 : 0) + (index === route.legs.length - 1 ? 10 : 0)
      : 0;

    const durationSeconds = Math.max(freeFlow, capped) + transition + endpointDelay;
    const routeDurationStartSeconds = elapsed;
    elapsed += durationSeconds;

    previous = leg;

    return {
      ...leg,
      freeFlowDurationSeconds: freeFlow,
      durationSeconds,
      routeDurationStartSeconds,
      routeDurationEndSeconds: elapsed
    };
  });

  return {
    ...route,
    freeFlowDurationSeconds: Number(route.durationSeconds ?? 0),
    legs: calibratedLegs,
    durationSeconds: elapsed
  };
}
