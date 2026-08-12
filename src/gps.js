import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';


const EARTH_RADIUS_METERS = 6371000;

// Ignore tiny movements because they are dominated by GPS jitter.
const COURSE_MIN_DISTANCE_METERS = 4;

// Do not derive a new course from a very old pair of fixes.
const COURSE_MAX_FIX_AGE_MS = 15000;

// Higher = follows direction changes faster.
// 0.35 gives useful smoothing without making turns feel excessively slow.
const COURSE_HEADING_ALPHA = 0.35;

const MOTION_MIN_SPEED_METERS_PER_SECOND = 0.55;
const MOTION_STOP_TIMEOUT_MS = 4000;
const MOTION_MIN_DISTANCE_METERS = 4;

// Movement must exceed a meaningful fraction of the
// horizontal GPS uncertainty before it is trusted.
//
// Examples:
//   8 m accuracy   -> 4 m minimum
//   20 m accuracy  -> 10 m
//   40 m accuracy  -> 20 m
//   120 m accuracy -> 60 m
const MOTION_ACCURACY_DISTANCE_FACTOR = 0.5;

// Provider speed is NOT trusted as the navigation speed,
// but it is useful as a plausibility bound.
//
// A GPS jump implying 24 m/s while Android reports
// roughly 1.5 m/s is almost certainly position noise.
const MOTION_SPEED_PLAUSIBILITY_MULTIPLIER = 3;
const MOTION_SPEED_PLAUSIBILITY_FLOOR = 3.5;

const MOTION_ESTIMATE_MIN_SPAN_MS = 3000;
const MOTION_ESTIMATE_MIN_SPEED_METERS_PER_SECOND = 0.45;

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

function normalizeHeading(heading) {
  return (heading % 360 + 360) % 360;
}

function distanceMeters(a, b) {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat =
    toRadians(b.latitude - a.latitude);
  const deltaLon =
    toRadians(b.longitude - a.longitude);

  const sinLat =
    Math.sin(deltaLat / 2);
  const sinLon =
    Math.sin(deltaLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLon *
      sinLon;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(
      Math.sqrt(h),
      Math.sqrt(1 - h)
    )
  );
}

function bearingBetween(a, b) {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLon =
    toRadians(b.longitude - a.longitude);

  const y =
    Math.sin(deltaLon) *
    Math.cos(lat2);

  const x =
    Math.cos(lat1) *
      Math.sin(lat2) -
    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(deltaLon);

  return normalizeHeading(
    toDegrees(Math.atan2(y, x))
  );
}

function smoothHeading(current, target, alpha) {
  if (!Number.isFinite(current)) {
    return normalizeHeading(target);
  }

  const delta =
    ((target - current + 540) % 360) - 180;

  return normalizeHeading(
    current + delta * alpha
  );
}



export class GpsController {
  constructor({ onUpdate, onStatus }) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;

    this.watchId = null;
    this.native = Capacitor.isNativePlatform();
    this.bestAccuracy = Infinity;

    // Last position used as the origin of a movement-course
    // measurement. This intentionally does not move on every
    // GPS fix: we wait until the device has travelled far
    // enough to distinguish movement from GPS jitter.
    this.courseAnchor = null;
    this.courseHeading = null;

    this.motionConfirmed = false;
    this.motionSpeed = 0;
    this.lastConfirmedMoveAt = null;
  }

  get enabled() {
    return this.watchId !== null;
  }

  async start() {
    if (this.enabled) {
      return;
    }

    this.bestAccuracy = Infinity;
    this.courseAnchor = null;
    this.courseHeading = null;
    this.motionConfirmed = false;
    this.motionSpeed = 0;
    this.lastConfirmedMoveAt = null;
    this.onStatus(
      'Requesting GPS…',
      'Allow precise location access when Android asks.'
    );

    if (this.native) {
      await this.#startNative();
      return;
    }

    this.#startBrowser();
  }

  async stop() {
    if (this.watchId === null) {
      return;
    }

    if (this.native) {
      await Geolocation.clearWatch({
        id: this.watchId
      });
    } else {
      navigator.geolocation.clearWatch(
        this.watchId
      );
    }

    this.watchId = null;
    this.bestAccuracy = Infinity;
    this.courseAnchor = null;
    this.courseHeading = null;
    this.motionConfirmed = false;
    this.motionSpeed = 0;
    this.lastConfirmedMoveAt = null;
  }

  async #startNative() {
    try {
      const permissions =
        await Geolocation.requestPermissions();

      if (permissions.location !== 'granted') {
        this.onStatus(
          'Precise GPS required',
          'Enable precise location for navigation.'
        );

        return;
      }

      this.watchId =
        await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
            minimumUpdateInterval: 1000,
            interval: 1000
          },
          (position, error) => {
            if (error) {
              this.handleError(error);
              return;
            }

            if (position) {
              this.handlePosition(position);
            }
          }
        );
    } catch (error) {
      this.handleError(error);
    }
  }

  #startBrowser() {
    if (
      typeof navigator === 'undefined' ||
      !('geolocation' in navigator)
    ) {
      this.onStatus(
        'GPS unavailable',
        'This browser does not provide geolocation.'
      );

      return;
    }

    this.watchId =
      navigator.geolocation.watchPosition(
        position =>
          this.handlePosition(position),
        error =>
          this.handleError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 30000
        }
      );
  }

  handlePosition(position) {
    const {
      latitude,
      longitude,
      accuracy,
      heading,
      speed
    } = position.coords;

    if (
      ![
        latitude,
        longitude,
        accuracy
      ].every(Number.isFinite)
    ) {
      return;
    }

    if (accuracy > 150) {
      this.onStatus(
        '📍 Low GPS accuracy',
        `Current accuracy is about ${Math.round(
          accuracy
        )} m.`
      );
    }

    this.bestAccuracy =
      Math.min(this.bestAccuracy, accuracy);

    const now =
      Number.isFinite(position?.timestamp)
        ? position.timestamp
        : Date.now();

    const fix = {
      latitude,
      longitude,
      accuracy,
      timestamp: now
    };

    if (!this.courseAnchor) {
      this.courseAnchor = fix;
    } else {
      const age =
        now - this.courseAnchor.timestamp;

      if (age > COURSE_MAX_FIX_AGE_MS) {
        this.courseAnchor = fix;
        this.motionConfirmed = false;
        this.motionSpeed = 0;
        this.lastConfirmedMoveAt = null;
      } else if (age > 0) {
        const travelled =
          distanceMeters(
            this.courseAnchor,
            fix
          );

        const elapsedSeconds =
          age / 1000;

        const observedSpeed =
          travelled / elapsedSeconds;

        // Use the worse of the two fixes. A displacement
        // smaller than a meaningful fraction of the current
        // uncertainty cannot reliably establish movement.
        const anchorAccuracy =
          Number.isFinite(
            this.courseAnchor.accuracy
          )
            ? this.courseAnchor.accuracy
            : accuracy;

        const uncertainty =
          Math.max(
            accuracy,
            anchorAccuracy
          );

        const requiredDistance =
          Math.max(
            MOTION_MIN_DISTANCE_METERS,
            uncertainty *
              MOTION_ACCURACY_DISTANCE_FACTOR
          );

        // Raw provider speed is too noisy to drive the marker,
        // but it can reject physically inconsistent GPS jumps.
        const providerSpeed =
          Number.isFinite(speed) &&
          speed >= 0
            ? speed
            : null;

        const plausibleObservedSpeed =
          providerSpeed === null ||
          observedSpeed <=
            Math.max(
              MOTION_SPEED_PLAUSIBILITY_FLOOR,
              providerSpeed *
                MOTION_SPEED_PLAUSIBILITY_MULTIPLIER
            );

        const movementConfirmed =
          travelled >= requiredDistance &&
          observedSpeed >=
            MOTION_MIN_SPEED_METERS_PER_SECOND &&
          plausibleObservedSpeed;

        if (movementConfirmed) {
          const movementHeading =
            bearingBetween(
              this.courseAnchor,
              fix
            );

          this.courseHeading =
            smoothHeading(
              this.courseHeading,
              movementHeading,
              COURSE_HEADING_ALPHA
            );

          this.motionConfirmed = true;

          // Coordinate displacement confirms that movement
          // is real, but must not determine navigation speed.
          // Noisy GPS geometry can imply absurd velocities.
          this.lastConfirmedMoveAt = now;

          this.courseAnchor = fix;
        } else if (
          this.motionConfirmed &&
          this.lastConfirmedMoveAt !== null &&
          now - this.lastConfirmedMoveAt >=
            MOTION_STOP_TIMEOUT_MS
        ) {
          // Native providers can report non-zero speed while
          // stationary, especially indoors. Stop prediction
          // unless movement is corroborated by displacement.
          this.motionConfirmed = false;
          this.motionSpeed = 0;

          // Start a fresh displacement window from here.
          this.courseAnchor = fix;
        }
      }
    }

    const nativeHeading =
      Number.isFinite(heading)
        ? normalizeHeading(heading)
        : null;

    const providerSpeed =
      Number.isFinite(speed) &&
      speed >= 0
        ? speed
        : 0;

    /*
     * Position displacement decides WHETHER movement is real.
     * Android's speed estimate decides HOW FAST once movement
     * has been corroborated.
     *
     * This avoids deriving absurd 3-20 m/s speeds from noisy
     * coordinates while still rejecting bogus non-zero speed
     * when stationary.
     */
    if (this.motionConfirmed) {
      this.motionSpeed =
        this.motionSpeed > 0
          ? (
              this.motionSpeed * 0.65 +
              providerSpeed * 0.35
            )
          : providerSpeed;
    } else {
      this.motionSpeed = 0;
    }

    const resolvedHeading =
      Number.isFinite(this.courseHeading)
        ? this.courseHeading
        : nativeHeading;

    this.onUpdate({
      latitude,
      longitude,
      accuracy,
      heading: resolvedHeading,
      speed:
        this.motionConfirmed
          ? this.motionSpeed
          : 0
    });
  }

  handleError(error) {
    const messages = {
      1: 'Location permission was denied.',
      2: 'Your location could not be determined.',
      3: 'GPS request timed out.'
    };

    this.onStatus(
      'GPS unavailable',
      messages[error?.code] ??
        error?.message ??
        'Unable to read your location.'
    );
  }
}
