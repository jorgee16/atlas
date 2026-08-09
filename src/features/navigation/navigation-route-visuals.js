function normalizeBearing(value) {
  return (
    (Number(value) % 360) + 360
  ) % 360;
}

function interpolatePoint(start, end, fraction) {
  return {
    lat:
      start.lat +
      (end.lat - start.lat) * fraction,
    lon:
      start.lon +
      (end.lon - start.lon) * fraction
  };
}

function pointBearing(from, to) {
  const latitude1 =
    from.lat * Math.PI / 180;
  const latitude2 =
    to.lat * Math.PI / 180;
  const longitudeDelta =
    (to.lon - from.lon) * Math.PI / 180;

  const y =
    Math.sin(longitudeDelta) *
    Math.cos(latitude2);

  const x =
    Math.cos(latitude1) *
      Math.sin(latitude2) -
    Math.sin(latitude1) *
      Math.cos(latitude2) *
      Math.cos(longitudeDelta);

  return normalizeBearing(
    Math.atan2(y, x) * 180 / Math.PI
  );
}

export function splitRouteAtProgress(
  points,
  progress
) {
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    !Number.isInteger(progress?.pointIndex)
  ) {
    return {
      traveled: [],
      remaining: [...(points ?? [])],
      splitPoint: points?.[0] ?? null
    };
  }

  const pointIndex = Math.max(
    0,
    Math.min(
      points.length - 2,
      progress.pointIndex
    )
  );

  const fraction = Math.max(
    0,
    Math.min(
      1,
      progress.segmentFraction ?? 0
    )
  );

  const splitPoint = interpolatePoint(
    points[pointIndex],
    points[pointIndex + 1],
    fraction
  );

  return {
    traveled: [
      ...points.slice(0, pointIndex + 1),
      splitPoint
    ],
    remaining: [
      splitPoint,
      ...points.slice(pointIndex + 1)
    ],
    splitPoint
  };
}

export function routeBearingFromProgress(
  points,
  progress
) {
  const split = splitRouteAtProgress(
    points,
    progress
  );

  const lookAheadIndex = Math.min(
    split.remaining.length - 1,
    4
  );

  if (!split.splitPoint || lookAheadIndex < 1) {
    return null;
  }

  return pointBearing(
    split.splitPoint,
    split.remaining[lookAheadIndex]
  );
}
