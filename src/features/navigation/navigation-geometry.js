const EARTH_RADIUS_METERS = 6371000;

const toRadians = degrees =>
  degrees * Math.PI / 180;

const toDegrees = radians =>
  radians * 180 / Math.PI;

export function distanceMeters(
  from,
  to
) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const deltaLat =
    toRadians(to.lat - from.lat);

  const deltaLon =
    toRadians(to.lon - from.lon);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

  const centralAngle =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return EARTH_RADIUS_METERS *
    centralAngle;
}

export function bearingDegrees(
  from,
  to
) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const deltaLon =
    toRadians(to.lon - from.lon);

  const y =
    Math.sin(deltaLon) *
    Math.cos(lat2);

  const x =
    Math.cos(lat1) *
      Math.sin(lat2) -
    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(deltaLon);

  return (
    toDegrees(Math.atan2(y, x)) +
    360
  ) % 360;
}

export function cardinalDirection(
  bearing
) {
  const directions = [
    'N',
    'NE',
    'E',
    'SE',
    'S',
    'SW',
    'W',
    'NW'
  ];

  const index =
    Math.round(bearing / 45) %
    directions.length;

  return directions[index];
}
