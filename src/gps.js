export class GpsController {
  constructor({onUpdate, onStatus}) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.watchId = null;
    this.bestAccuracy = Infinity;
  }

  get enabled() { return this.watchId !== null; }

  start() {
    if (!('geolocation' in navigator)) {
      this.onStatus('GPS unavailable', 'This browser does not provide geolocation.');
      return;
    }
    if (this.enabled) return;
    this.bestAccuracy = Infinity;
    this.onStatus('Requesting GPS…', 'Allow precise location access when Android asks.');
    this.watchId = navigator.geolocation.watchPosition(
      position => this.handlePosition(position),
      error => this.handleError(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.bestAccuracy = Infinity;
  }

  handlePosition(position) {
    const {latitude, longitude, accuracy} = position.coords;
    if (![latitude, longitude, accuracy].every(Number.isFinite)) return;
    if (accuracy > 150) {
      this.onStatus('📍 Waiting for a precise fix', `Current accuracy is about ${Math.round(accuracy)} m.`);
      return;
    }
    if (accuracy > this.bestAccuracy + 100 && this.bestAccuracy < 50) return;
    this.bestAccuracy = accuracy;
    this.onUpdate({latitude, longitude, accuracy});
  }

  handleError(error) {
    const messages = {1:'Location permission was denied.',2:'Your location could not be determined.',3:'GPS request timed out.'};
    this.onStatus('GPS unavailable', messages[error.code] ?? 'Unable to read your location.');
  }
}
