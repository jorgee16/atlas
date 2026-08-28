import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  MapLibreMapAdapter
} from './maplibre-map-adapter.js';
import {
  createMapLibrePmtilesStyle
} from './layers/maplibre-pmtiles-style.js';
import {
  installMapLibreZoomControl
} from './maplibre-zoom-control.js';

export class MapLibrePmtilesMapAdapter extends MapLibreMapAdapter {
  constructor({
    maplibre = maplibregl,
    createOfflineStyle = createMapLibrePmtilesStyle,
    ...options
  } = {}) {
    super({
      ...options,
      maplibre,
      createOfflineStyle
    });

    this.currentRoute = null;
    this.currentRouteProgress = null;
    this.currentManeuvers = null;
    this.currentManeuverIndex = 0;
    this.restoringStyleOverlays = false;
    this.mapSourceMode = 'online';

    this.zoomControlElement =
      installMapLibreZoomControl(this.map);

    this.mapSourceBadge =
      document.createElement('div');
    this.mapSourceBadge.className =
      'atlas-maplibre-source-badge';
    this.map.getContainer().appendChild(
      this.mapSourceBadge
    );
    this.#renderMapSourceBadge();

    // MapLibre removes every custom source/layer whenever setStyle()
    // switches between the online and offline base map. Navigation state
    // lives outside the renderer, so recreate Atlas overlays after each
    // style load instead of letting a base-map change erase the route.
    this.map.on('style.load', () => {
      this.#restoreStyleOverlays();
    });
  }

  async setRegion(region, options = {}) {
    const preferOffline =
      Boolean(options?.preferOffline);

    const offlineLoaded =
      await super.setRegion(region, options);

    this.mapSourceMode =
      preferOffline && offlineLoaded
        ? 'offline'
        : 'online';

    this.#renderMapSourceBadge();
    return offlineLoaded;
  }

  showRoute(route, endpoints = {}) {
    const result =
      super.showRoute(route, endpoints);

    this.currentRoute = route;
    return result;
  }

  fitRoute(route, options = {}) {
    if (this.restoringStyleOverlays) {
      return true;
    }

    return super.fitRoute(route, options);
  }

  updateRouteProgress(route, progress) {
    this.currentRoute = route ?? this.currentRoute;
    this.currentRouteProgress = progress ?? null;

    return super.updateRouteProgress(
      route,
      progress
    );
  }

  showManeuvers(maneuvers, activeIndex = 0) {
    this.currentManeuvers =
      Array.isArray(maneuvers)
        ? maneuvers
        : null;
    this.currentManeuverIndex = activeIndex;

    return super.showManeuvers(
      maneuvers,
      activeIndex
    );
  }

  clearManeuvers() {
    if (!this.restoringStyleOverlays) {
      this.currentManeuvers = null;
      this.currentManeuverIndex = 0;
    }

    return super.clearManeuvers();
  }

  clearRoute() {
    if (!this.restoringStyleOverlays) {
      this.currentRoute = null;
      this.currentRouteProgress = null;
    }

    return super.clearRoute();
  }

  #restoreStyleOverlays() {
    if (
      this.restoringStyleOverlays ||
      !this.currentRoute
    ) {
      return;
    }

    this.restoringStyleOverlays = true;

    try {
      // Use the normal renderer paths so restored overlays stay identical
      // to the ones created when the route was first selected. fitRoute()
      // is suppressed during restoration so the user's navigation camera
      // is not unexpectedly reset by a base-style change.
      super.showRoute(this.currentRoute);

      if (this.currentRouteProgress) {
        super.updateRouteProgress(
          this.currentRoute,
          this.currentRouteProgress
        );
      }

      if (this.currentManeuvers) {
        super.showManeuvers(
          this.currentManeuvers,
          this.currentManeuverIndex
        );
      }
    } finally {
      this.restoringStyleOverlays = false;
    }
  }

  #renderMapSourceBadge() {
    if (!this.mapSourceBadge) return;

    const offline =
      this.mapSourceMode === 'offline';

    this.mapSourceBadge.textContent =
      offline ? 'Offline map' : 'Online map';
    this.mapSourceBadge.dataset.mode =
      offline ? 'offline' : 'online';
    this.mapSourceBadge.title =
      offline
        ? 'Atlas is using the downloaded regional map.'
        : 'Atlas is using the online OpenStreetMap layer.';
  }
}
