const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

const NAVIGATION_CAMERA_PROFILES = Object.freeze({
  drive: Object.freeze({
    forwardFraction: 0.23,
    forwardMaxPixels: 320,
    pitchMin: 44,
    pitchMax: 64
  }),
  walk: Object.freeze({
    forwardFraction: 0.16,
    forwardMaxPixels: 140,
    pitchMin: 0,
    pitchMax: 18
  })
});

export function navigationCameraProfile(
  travelMode = null
) {
  return NAVIGATION_CAMERA_PROFILES[travelMode] ??
    Object.freeze({
      forwardFraction: 0,
      forwardMaxPixels: 0,
      pitchMin: 0,
      pitchMax: 0
    });
}

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

function maneuverContext(progress) {
  const maneuver = progress?.nextManeuver;
  const distance = progress?.distanceToManeuverMeters;

  if (!maneuver || !Number.isFinite(distance) || distance < 0) {
    return {
      distance: Infinity,
      roundabout: false,
      complex: false
    };
  }

  const text = maneuverText(maneuver);
  const roundabout = /roundabout|rotary/.test(text);
  const complex =
    roundabout ||
    /fork|ramp|merge|exit|sharp|u-turn|uturn/.test(text);

  return {
    distance,
    roundabout,
    complex
  };
}

function drivingCruiseFactor({
  speed,
  progress
}) {
  const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const speedKph = speedMps * 3.6;
  const { distance } = maneuverContext(progress);

  const speedFactor = clamp((speedKph - 55) / 55, 0, 1);
  const distanceFactor = clamp((distance - 450) / 2200, 0, 1);

  return speedFactor * distanceFactor;
}

function drivingManeuverFactor({
  speed,
  progress
}) {
  const { distance, complex, roundabout } = maneuverContext(progress);
  if (!Number.isFinite(distance)) return 0;

  const speedMps = Number.isFinite(speed) ? Math.max(speed, 4) : 4;
  const secondsToManeuver = distance / speedMps;
  const distanceWindow = roundabout
    ? 300
    : complex
      ? 250
      : 170;
  const timeWindow = roundabout
    ? 24
    : complex
      ? 20
      : 14;

  return Math.max(
    clamp(1 - distance / distanceWindow, 0, 1),
    clamp(1 - secondsToManeuver / timeWindow, 0, 1)
  );
}

export function navigationForwardOffset({
  travelMode = null,
  height = 0,
  headingUp = false,
  speed = null,
  progress = null
} = {}) {
  if (!headingUp || !Number.isFinite(height) || height <= 0) {
    return 0;
  }

  const profile = navigationCameraProfile(travelMode);
  const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;

  const speedBoost =
    travelMode === 'drive'
      ? clamp(speedMps / 30, 0, 1) * 0.045
      : 0;

  let fraction = profile.forwardFraction + speedBoost;

  if (travelMode === 'drive') {
    const cruise = drivingCruiseFactor({ speed, progress });
    const maneuver = drivingManeuverFactor({ speed, progress });

    // On a long/simple road put more map ahead of the vehicle. As a junction
    // approaches, pull the visual focus back toward the car so the maneuver
    // itself remains inside the useful portion of the screen.
    fraction += cruise * 0.035;
    fraction -= maneuver * 0.055;
  }

  return Math.min(
    profile.forwardMaxPixels,
    height * Math.max(0, fraction)
  );
}

export function navigationPitch({
  travelMode = null,
  headingUp = false,
  speed = null,
  progress = null
} = {}) {
  if (!headingUp || !travelMode) return 0;

  const profile = navigationCameraProfile(travelMode);

  if (travelMode !== 'drive') {
    return profile.pitchMin;
  }

  const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const speedKph = speedMps * 3.6;
  const speedFactor = clamp(speedKph / 95, 0, 1);
  const cruise = drivingCruiseFactor({ speed, progress });
  const maneuver = drivingManeuverFactor({ speed, progress });

  let pitch =
    profile.pitchMin +
    (profile.pitchMax - profile.pitchMin) * speedFactor;

  // Cruise gets a slightly more road-like perspective and better horizon.
  // Maneuver focus deliberately flattens the map again for junction geometry.
  pitch += cruise * 3;
  pitch -= maneuver * 11;

  return clamp(pitch, 40, profile.pitchMax);
}

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
        ? 250
        : 170;

  const timeWindow =
    walking
      ? 55
      : complex
        ? 20
        : 14;

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
        ? 0.85
        : complex
          ? 0.65
          : 0.4;

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

  const cruiseZoomOut =
    travelMode === 'drive'
      ? drivingCruiseFactor({ speed, progress }) * 0.7
      : 0;

  return clamp(
    baseZoom - cruiseZoomOut + focus,
    16.2,
    19
  );
}
