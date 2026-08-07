import {
  NavigationSession
} from './navigation-session.js';

import {
  distanceMeters,
  bearingDegrees,
  cardinalDirection
} from './navigation-geometry.js';

export class NavigationFeature {
  constructor({
    map,
    panelController,
    listElement,
    status,
    session = new NavigationSession()
  }) {
    if (
      !map ||
      !panelController ||
      !listElement
    ) {
      throw new TypeError(
        'NavigationFeature requires map, panelController and listElement.'
      );
    }

    this.map = map;
    this.panelController =
      panelController;
    this.listElement = listElement;
    this.status = status;
    this.session = session;
  }

  start({
    origin,
    destination
  }) {
    this.session.start({
      origin,
      destination
    });

    this.panelController.show(
      'navigation',
      { snap: 'half' }
    );

    this.render();

    this.map.focus(
      destination.lat,
      destination.lon,
      15
    );

    this.status(
      'Navigation started',
      destination.name ??
        'Selected destination'
    );
  }

  updatePosition(position) {
    if (!this.session.isActive()) {
      return;
    }

    this.session.updateOrigin({
      lat:
        position.lat ??
        position.latitude,
      lon:
        position.lon ??
        position.longitude
    });

    this.render();
  }

  stop() {
    if (!this.session.isActive()) {
      return;
    }

    this.session.stop();
    this.listElement.replaceChildren();
    this.panelController.hide();

    this.status(
      'Navigation stopped',
      ''
    );
  }

  isActive() {
    return this.session.isActive();
  }

  render() {
    const {
      origin,
      destination
    } = this.session.getState();

    if (!origin || !destination) {
      return;
    }

    const distance =
      distanceMeters(
        origin,
        destination
      );

    const bearing =
      bearingDegrees(
        origin,
        destination
      );

    this.listElement.replaceChildren();

    const container =
      document.createElement('section');

    container.className =
      'navigation-panel';

    const destinationName =
      destination.name ??
      'Destination';

    container.innerHTML = `
      <div class="section-title">
        Navigation
      </div>

      <div class="navigation-summary">
        <strong>${destinationName}</strong>

        <span>
          ${this.#formatDistance(distance)}
          · ${cardinalDirection(bearing)}
          · ${Math.round(bearing)}°
        </span>

        <small>
          Direct distance — road routing
          will be added next.
        </small>
      </div>
    `;

    const stopButton =
      document.createElement('button');

    stopButton.type = 'button';
    stopButton.className =
      'navigation-stop-button';

    stopButton.textContent =
      'Stop navigation';

    stopButton.addEventListener(
      'click',
      () => this.stop()
    );

    container.appendChild(stopButton);
    this.listElement.appendChild(container);
  }

  #formatDistance(distance) {
    if (distance < 1000) {
      return `${Math.round(distance)} m`;
    }

    return `${(
      distance / 1000
    ).toFixed(1)} km`;
  }
}
