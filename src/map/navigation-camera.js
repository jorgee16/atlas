const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

const maneuverText = maneuver =>
  [
    maneuver?.type,
    maneuver?.modifier,
    maneuver?.instruction,
    maneuver?.name
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

function drivingBaseZoom(
  speed,
  preferredZoom
) {
  const speedMps =
    Number.isFinite(speed)
      ? Math.max(0, speed)
      : 0;

  const speedKph =
    speedMps * 3.6;

  /*
   * preferredZoom is the user's follow preference:
   * near   -> 19
   * normal -> 18
   * far    -> 17
   *
   * Speed adjusts around that preference rather than
   * replacing it completely.
   */
  let offset = 0;

  if (speedKph <= 15) {
    offset = 0.35;
  } else if (speedKph <= 40) {
    offset =
      0.35 -
      (
        (speedKph - 15) /
        25
      ) * 0.35;
  } else if (speedKph <= 70) {
    offset =
      -(
        (speedKph - 40) /
        30
      ) * 0.4;
  } else if (speedKph <= 110) {
    offset =
      -0.4 -
      (
        (speedKph - 70) /
        40
      ) * 0.4;
  } else {
    offset = -0.8;
  }

  return preferredZoom + offset;
}

function walkingBaseZoom(
  preferredZoom
) {
  /*
   * Walking benefits from a closer map.
   * Keep the user's preference meaningful.
   */
  return preferredZoom + 0.35;
}

function maneuverFocus({
  travelMode,
  speed,
  progress
}) {
  const maneuver =
    progress?.nextManeuver;

  const distance =
    progress?.distanceToManeuverMeters;

  if (
    !maneuver ||
    !Number.isFinite(distance) ||
    distance < 0
  ) {
    return 0;
  }

  const text =
    maneuverText(maneuver);

  const roundabout =
    /roundabout|rotary/.test(text);

  const complex =
    roundabout ||
    /fork|ramp|merge|exit|sharp|u-turn|uturn/.test(
      text
    );

  const walking =
    travelMode === 'walk';

  const speedMps =
    Number.isFinite(speed)
      ? Math.max(speed, 0)
      : 0;

  /*
   * Use a minimum effective speed so GPS noise at rest
   * does not make time-to-turn explode.
   */
  const effectiveSpeed =
    walking
      ? Math.max(speedMps, 1.2)
      : Math.max(speedMps, 4);

  const secondsToManeuver =
    distance / effectiveSpeed;

  const distanceWindow =
    walking
      ? complex
        ? 100
        : 70
      : complex
        ? 220
        : 150;

  const timeWindow =
    walking
      ? 55
      : complex
        ? 18
        : 13;

  const distanceRelevance =
    clamp(
      1 -
        distance /
          distanceWindow,
      0,
      1
    );

  const timeRelevance =
    clamp(
      1 -
        secondsToManeuver /
          timeWindow,
      0,
      1
    );

  /*
   * Either time or distance can make a maneuver relevant.
   * This means:
   * - high speed -> focus starts farther away
   * - low speed -> we wait until geographically closer
   */
  const relevance =
    Math.max(
      distanceRelevance,
      timeRelevance
    );

  if (relevance <= 0) {
    return 0;
  }

  const maximumFocus =
    walking
      ? complex
        ? 0.7
        : 0.4
      : roundabout
        ? 0.75
        : complex
          ? 0.55
          : 0.35;

  return maximumFocus * relevance;
}

export function adaptiveNavigationZoom({
  travelMode = 'drive',
  speed = null,
  preferredZoom = 18,
  progress = null
} = {}) {
  const normalizedPreferredZoom =
    Number.isFinite(preferredZoom)
      ? preferredZoom
      : 18;

  const baseZoom =
    travelMode === 'walk'
      ? walkingBaseZoom(
          normalizedPreferredZoom
        )
      : drivingBaseZoom(
          speed,
          normalizedPreferredZoom
        );

  const focus =
    maneuverFocus({
      travelMode,
      speed,
      progress
    });

  return clamp(
    baseZoom + focus,
    16.5,
    19
  );
}
