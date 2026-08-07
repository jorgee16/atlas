export class NavigationSession {
  constructor() {
    this.active = false;
    this.origin = null;
    this.destination = null;
    this.route = null;
  }

  start({
    origin,
    destination,
    route = null
  }) {
    this.#validatePoint(origin, 'origin');
    this.#validatePoint(
      destination,
      'destination'
    );

    this.active = true;
    this.origin = { ...origin };
    this.destination = { ...destination };
    this.route = route;

    return this.getState();
  }

  stop() {
    this.active = false;
    this.origin = null;
    this.destination = null;
    this.route = null;
  }

  updateOrigin(origin) {
    this.#validatePoint(origin, 'origin');

    if (!this.active) {
      return;
    }

    this.origin = { ...origin };
  }

  setRoute(route) {
    this.route = route;
  }

  isActive() {
    return this.active;
  }

  getState() {
    return {
      active: this.active,
      origin: this.origin,
      destination: this.destination,
      route: this.route
    };
  }

  #validatePoint(point, label) {
    if (
      !point ||
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lon)
    ) {
      throw new TypeError(
        `Navigation ${label} requires lat and lon.`
      );
    }
  }
}
