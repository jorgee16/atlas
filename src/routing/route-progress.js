import {
  distanceMeters
} from '../features/navigation/navigation-geometry.js';

export function routeCumulativeDistances(points) {
  const cumulative = new Float64Array(
    points.length
  );

  for (
    let index = 1;
    index < points.length;
    index += 1
  ) {
    cumulative[index] =
      cumulative[index - 1] +
      distanceMeters(
        points[index - 1],
        points[index]
      );
  }

  return cumulative;
}

function projectOntoSegment(
  position,
  start,
  end
) {
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree =
    metersPerLatitudeDegree *
    Math.max(
      Math.cos(
        position.lat * Math.PI / 180
      ),
      0.01
    );

  const startX =
    (start.lon - position.lon) *
    metersPerLongitudeDegree;

  const startY =
    (start.lat - position.lat) *
    metersPerLatitudeDegree;

  const segmentX =
    (end.lon - start.lon) *
    metersPerLongitudeDegree;

  const segmentY =
    (end.lat - start.lat) *
    metersPerLatitudeDegree;

  const segmentSquared =
    segmentX * segmentX +
    segmentY * segmentY;

  const fraction = segmentSquared > 0
    ? Math.max(
        0,
        Math.min(
          1,
          -(
            startX * segmentX +
            startY * segmentY
          ) / segmentSquared
        )
      )
    : 0;

  const nearestX =
    startX + fraction * segmentX;

  const nearestY =
    startY + fraction * segmentY;

  return {
    fraction,
    distanceMeters: Math.hypot(
      nearestX,
      nearestY
    )
  };
}

export function findRouteProgress(
  position,
  route,
  {
    previousPointIndex = null,
    searchWindow = 300
  } = {}
) {
  const points = route?.points ?? [];

  if (
    !Number.isFinite(position?.lat) ||
    !Number.isFinite(position?.lon) ||
    points.length < 2
  ) {
    return null;
  }

  const cumulative =
    route.cumulativeDistances ??
    routeCumulativeDistances(points);

  const fullSearch =
    !Number.isInteger(previousPointIndex);

  const firstSegment = fullSearch
    ? 0
    : Math.max(
        0,
        previousPointIndex - 30
      );

  const lastSegment = fullSearch
    ? points.length - 2
    : Math.min(
        points.length - 2,
        previousPointIndex + searchWindow
      );

  let nearest = null;

  for (
    let index = firstSegment;
    index <= lastSegment;
    index += 1
  ) {
    const projection = projectOntoSegment(
      position,
      points[index],
      points[index + 1]
    );

    if (
      nearest &&
      projection.distanceMeters >=
        nearest.distanceFromRouteMeters
    ) {
      continue;
    }

    const segmentMeters =
      cumulative[index + 1] -
      cumulative[index];

    nearest = {
      pointIndex: index,
      segmentFraction: projection.fraction,
      distanceFromRouteMeters:
        projection.distanceMeters,
      geometryDistanceMeters:
        cumulative[index] +
        segmentMeters * projection.fraction
    };
  }

  if (!nearest) {
    return null;
  }

  const geometryTotal =
    cumulative[cumulative.length - 1];

  const routeScale = geometryTotal > 0
    ? route.distanceMeters / geometryTotal
    : 1;

  const distanceAlongRouteMeters =
    Math.max(
      0,
      Math.min(
        route.distanceMeters,
        nearest.geometryDistanceMeters *
          routeScale
      )
    );

  const foundManeuverIndex =
    distanceAlongRouteMeters < 25
      ? 0
      : route.maneuvers.findIndex(
          (maneuver, index) =>
            index > 0 &&
            (
              maneuver.routeDistanceMeters >
                distanceAlongRouteMeters + 12 ||
              maneuver.type === 'arrive'
            )
        );

  const nextManeuverIndex =
    foundManeuverIndex >= 0
      ? foundManeuverIndex
      : route.maneuvers.length - 1;

  const nextManeuver =
    route.maneuvers[nextManeuverIndex] ??
    route.maneuvers[
      route.maneuvers.length - 1
    ];

  const remainingDistanceMeters =
    Math.max(
      0,
      route.distanceMeters -
        distanceAlongRouteMeters
    );

  const remainingDurationSeconds =
    route.distanceMeters > 0
      ? route.durationSeconds *
        remainingDistanceMeters /
        route.distanceMeters
      : 0;

  return {
    ...nearest,
    distanceAlongRouteMeters,
    remainingDistanceMeters,
    remainingDurationSeconds,
    nextManeuverIndex,
    nextManeuver,
    followingManeuver:
      route.maneuvers[
        nextManeuverIndex + 1
      ] ?? null,
    distanceToManeuverMeters:
      Math.max(
        0,
        nextManeuver.routeDistanceMeters -
          distanceAlongRouteMeters
      )
  };
}
