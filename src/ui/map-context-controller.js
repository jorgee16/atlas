export class MapContextController {
  constructor({
    titleElement,
    subtitleElement
  }) {
    if (!titleElement || !subtitleElement) {
      throw new TypeError(
        'MapContextController requires title and subtitle elements.'
      );
    }

    this.titleElement = titleElement;
    this.subtitleElement = subtitleElement;

    this.state = {
      mode: 'idle',
      heading: null,
      speed: null,
      center: null
    };

    this.render();
  }

  showIdle() {
    this.state = {
      ...this.state,
      mode: 'idle'
    };

    this.render();
  }

  showFollowing({
    heading = null,
    speed = null
  } = {}) {
    this.state = {
      ...this.state,
      mode: 'following',
      heading,
      speed
    };

    this.render();
  }

  showExploring({
    lat,
    lon,
    zoom
  }) {
    this.state = {
      ...this.state,
      mode: 'exploring',
      center: {
        lat,
        lon,
        zoom
      }
    };

    this.render();
  }

  render() {
    switch (this.state.mode) {
      case 'following':
        this.#renderFollowing();
        break;

      case 'exploring':
        this.#renderExploring();
        break;

      default:
        this.titleElement.textContent = 'Roam';
        this.subtitleElement.textContent = 'Exploring London';
        break;
    }
  }

  #renderFollowing() {
    this.titleElement.textContent = 'Following you';

    const heading = this.state.heading;
    const speed = this.state.speed;

    if (
      Number.isFinite(heading) &&
      Number.isFinite(speed)
    ) {
      this.subtitleElement.textContent =
        `${this.#formatHeading(heading)} · ${this.#formatSpeed(speed)}`;
      return;
    }

    if (Number.isFinite(heading)) {
      this.subtitleElement.textContent =
        this.#formatHeading(heading);
      return;
    }

    this.subtitleElement.textContent = 'Live GPS position';
  }

  #renderExploring() {
    this.titleElement.textContent = 'Exploring';

    const center = this.state.center;

    if (!center) {
      this.subtitleElement.textContent = 'Move the map to explore';
      return;
    }

    this.subtitleElement.textContent =
      `${center.lat.toFixed(4)}, ${center.lon.toFixed(4)} · z${center.zoom}`;
  }

  #formatHeading(heading) {
    const normalized =
      ((heading % 360) + 360) % 360;

    const directions = [
      'N', 'NE', 'E', 'SE',
      'S', 'SW', 'W', 'NW'
    ];

    const index =
      Math.round(normalized / 45) % directions.length;

    return `Heading ${directions[index]} · ${Math.round(normalized)}°`;
  }

  #formatSpeed(speedMetersPerSecond) {
    const kilometersPerHour =
      speedMetersPerSecond * 3.6;

    return `${kilometersPerHour.toFixed(1)} km/h`;
  }
}
