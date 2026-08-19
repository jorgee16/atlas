export class FollowModeController {
  constructor({
    map,
    mapContext,
    followButton,
    recenterButton,
    compassButton = null,
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
    this.compassButton = compassButton;
    this.status = status;

    // GPS availability and camera following are separate states.
    // Start unfollowed: GPS updates the marker, while Follow/Recenter own camera movement.
    this.enabled = false;
    this.navigationActive = false;
    this.navigationTracksPosition = true;
    this.headingUpEnabled = this.#loadBool('atlas.navigation.headingUp', true);
    this.followZoom = this.#loadZoom();
    this.position = null;
    this.mapCenter = null;

    this.#bind();
    this.#renderButton();
    this.#renderCompass(0);
  }

  updatePosition(position) {
    this.position = {
      name: 'My location',
      lat: position.latitude,
      lon: position.longitude,
      heading: position.heading,
      speed: position.speed
    };

    if (
      !this.enabled ||
      (
        this.navigationActive &&
        !this.navigationTracksPosition
      )
    ) {
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
    this.map.setBearing?.(0);
    this.#renderCompass(0);
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

    if (this.enabled) {
      this.#focusPosition();
    } else {
      this.map.focus(
        this.position.lat,
        this.position.lon,
        16
      );
    }

    return true;
  }

  setNavigationActive(
    active,
    {
      trackPosition = true
    } = {}
  ) {
    this.navigationActive = Boolean(active);
    this.navigationTracksPosition =
      Boolean(trackPosition);

    if (!this.navigationActive) {
      this.map.setBearing?.(0);
      this.#renderCompass(0);
      return;
    }

    if (
      this.navigationTracksPosition &&
      this.enabled &&
      this.position
    ) {
      this.#focusPosition();
    } else {
      this.#renderCompass(0);
    }
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

    this.compassButton?.addEventListener(
      'click',
      () => {
        if (!this.navigationActive) {
          return;
        }

        this.setHeadingUpEnabled(!this.headingUpEnabled);

        if (
          this.headingUpEnabled &&
          this.enabled &&
          this.position
        ) {
          this.#focusPosition();
        } else {
          this.map.setBearing?.(0);
          this.#renderCompass(0);
        }
      }
    );

    this.map.onUserMoveStart(() => {
      this.stopFollowing();
    });
  }

  #focusPosition() {
    const headingUp =
      this.navigationActive &&
      this.headingUpEnabled;

    const bearing =
      this.map.followPosition?.(
        this.position,
        {
          zoom: this.#zoomLevel(),
          headingUp
        }
      );

    if (bearing === undefined) {
      this.map.focus(
        this.position.lat,
        this.position.lon,
        headingUp ? this.#zoomLevel() : Math.max(14, this.#zoomLevel() - 1)
      );
    }

    this.#renderCompass(
      Number.isFinite(bearing)
        ? bearing
        : 0
    );
  }

  getHeadingUpEnabled() { return this.headingUpEnabled; }
  setHeadingUpEnabled(value) { this.headingUpEnabled = value === true; this.#save('atlas.navigation.headingUp', String(this.headingUpEnabled)); if (this.enabled && this.position) this.#focusPosition(); else if (!this.headingUpEnabled) this.map.setBearing?.(0); this.#renderCompass(0); return this.headingUpEnabled; }
  getFollowZoom() { return this.followZoom; }
  setFollowZoom(value) { if (!['near','normal','far'].includes(value)) return false; this.followZoom=value; this.#save('atlas.map.followZoom', value); if (this.enabled && this.position) this.#focusPosition(); return true; }
  #zoomLevel() { return { near:19, normal:18, far:17 }[this.followZoom] ?? 18; }
  #loadZoom() { try { const v=globalThis.localStorage?.getItem('atlas.map.followZoom'); return ['near','normal','far'].includes(v) ? v : 'normal'; } catch { return 'normal'; } }
  #loadBool(key,fallback) { try { const v=globalThis.localStorage?.getItem(key); return v == null ? fallback : v !== 'false'; } catch { return fallback; } }
  #save(key,value) { try { globalThis.localStorage?.setItem(key,value); } catch {} }

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

  #renderCompass(bearing) {
    if (!this.compassButton) {
      return;
    }

    this.compassButton.hidden =
      !this.navigationActive ||
      !this.navigationTracksPosition;

    this.compassButton.style?.setProperty(
      '--map-bearing',
      `${bearing}deg`
    );

    this.compassButton.setAttribute(
      'aria-pressed',
      String(this.headingUpEnabled)
    );

    const label = this.headingUpEnabled
      ? 'Switch to north-up map'
      : 'Switch to heading-up map';

    this.compassButton.setAttribute(
      'aria-label',
      label
    );

    this.compassButton.title = label;
  }
}
