import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export class GpsController {
  constructor({ onUpdate, onStatus }) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;

    this.watchId = null;
    this.native = Capacitor.isNativePlatform();
    this.bestAccuracy = Infinity;
  }

  get enabled() {
    return this.watchId !== null;
  }

  async start() {
    if (this.enabled) {
      return;
    }

    this.bestAccuracy = Infinity;

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
  }

  async #startNative() {
    try {
      const permissions =
        await Geolocation.requestPermissions();

      if (
        permissions.location !== 'granted' &&
        permissions.coarseLocation !== 'granted'
      ) {
        this.onStatus(
          'GPS unavailable',
          'Location permission was denied.'
        );

        return;
      }

      this.watchId =
        await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
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
        '📍 Waiting for a precise fix',
        `Current accuracy is about ${Math.round(
          accuracy
        )} m.`
      );

      return;
    }

    if (
      accuracy >
        this.bestAccuracy + 100 &&
      this.bestAccuracy < 50
    ) {
      return;
    }

    this.bestAccuracy = accuracy;

    this.onUpdate({
      latitude,
      longitude,
      accuracy,
      heading:
        Number.isFinite(heading)
          ? heading
          : null,
      speed:
        Number.isFinite(speed)
          ? speed
          : null
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
