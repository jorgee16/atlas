export class FollowModeController {
  constructor({
    map,
    mapContext,
    followButton,
    recenterButton,
    status
  }) {
    if (!map || !mapContext) {
      throw new TypeError(
        'FollowModeController requires map and mapContext.'
      );
    }

    this.map = map;
    this.mapContext = mapContext;
    this.followButton = followButton;
    this.recenterButton = recenterButton;
    this.status = status;

    this.enabled = true;
    this.position = null;
    this.mapCenter = null;

    this.#bind();
    this.#renderButton();
  }

  updatePosition(position) {
    this.position = {
      name: 'My location',
      lat: position.latitude,
      lon: position.longitude,
      heading: position.heading,
      speed: position.speed
    };

    if (!this.enabled) {
      return;
    }

    this.#focusPosition();

    this.mapContext.showFollowing({
      heading: position.heading,
      speed: position.speed
    });
  }

  updateMapCenter(center) {
    this.mapCenter = center;

    if (!this.enabled) {
      this.mapContext.showExploring(center);
    }
  }

  stopFollowing() {
    this.enabled = false;
    this.#renderButton();

    if (this.mapCenter) {
      this.mapContext.showExploring(this.mapCenter);
    } else {
      this.mapContext.showIdle();
    }
  }

  startFollowing() {
    if (!this.position) {
      this.status(
        'No GPS position',
        'Enable GPS and wait for a location fix first.'
      );

      return false;
    }

    this.enabled = true;
    this.#renderButton();
    this.#focusPosition();

    this.mapContext.showFollowing({
      heading: this.position.heading,
      speed: this.position.speed
    });

    return true;
  }

  isFollowing() {
    return this.enabled;
  }

  getPosition() {
    return this.position;
  }

  recenter() {
    if (!this.position) {
      this.status(
        'No GPS position',
        'Enable GPS and wait for a location fix first.'
      );

      return false;
    }

    this.map.focus(
      this.position.lat,
      this.position.lon,
      16
    );

    return true;
  }

  #bind() {
    this.followButton?.addEventListener(
      'click',
      () => {
        if (this.enabled) {
          this.stopFollowing();

          this.status(
            'Follow mode paused',
            'GPS remains active, but the map will not auto-center.'
          );

          return;
        }

        if (this.startFollowing()) {
          this.status(
            'Follow mode enabled',
            'The map will follow your live GPS position.'
          );
        }
      }
    );

    this.recenterButton?.addEventListener(
      'click',
      () => {
        if (this.recenter()) {
          this.status(
            '📍 Recentered',
            'Map centered on your current location.'
          );
        }
      }
    );

    this.map.onUserMoveStart(() => {
      this.stopFollowing();
    });
  }

  #focusPosition() {
    this.map.focus(
      this.position.lat,
      this.position.lon,
      16
    );
  }

  #renderButton() {
    if (!this.followButton) {
      return;
    }

    this.followButton.classList.toggle(
      'on',
      this.enabled
    );

    this.followButton.setAttribute(
      'aria-label',
      this.enabled
        ? 'Stop following my location'
        : 'Start following my location'
    );

    this.followButton.title =
      this.enabled
        ? 'Stop following'
        : 'Start following';
  }
}
