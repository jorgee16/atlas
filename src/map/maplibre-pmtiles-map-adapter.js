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

    // setStyle() destroys every Atlas custom source/layer. Keep the route
    // renderer self-healing so selecting a destination and pressing Start
    // never leaves guidance active with an invisible route.
    this.map.on('style.load', () => {
      this.#ensureRouteOverlay();
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

    // super.setRegion() returns immediately after setStyle(). The style may
    // still be loading, so also register a one-shot restoration here. The
    // permanent style.load listener above remains the safety net for later
    // style switches.
    if (this.currentRoute) {
      if (this.map.isStyleLoaded?.()) {
        this.#ensureRouteOverlay();
      } else {
        this.map.once('style.load', () => {
          this.#ensureRouteOverlay();
        });
      }
    }

    return offlineLoaded;
  }

  showRoute(route, endpoints = {}) {
    // Store route state BEFORE calling the base renderer. This matters when
    // showRoute() is invoked while MapLibre is in the middle of setStyle():
    // style.load can fire asynchronously before the base callback executes.
    this.currentRoute = route;
    this.currentRouteProgress = null;

    const result =
      super.showRoute(route, endpoints);

    // If the style is already ready, verify the overlay immediately. If it
    // is still loading, the style.load listeners will rebuild it afterwards.
    if (this.map.isStyleLoaded?.()) {
      queueMicrotask(() => {
        this.#ensureRouteOverlay();
      });
    }

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

    const result = super.updateRouteProgress(
      route,
      progress
    );

    if (this.map.isStyleLoaded?.()) {
      queueMicrotask(() => {
        this.#ensureRouteOverlay();
      });
    }

    return result;
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

  #ensureRouteOverlay() {
    if (
      this.restoringStyleOverlays ||
      !this.currentRoute ||
      !this.map.isStyleLoaded?.()
    ) {
      return;
    }

    const routeSource =
      this.map.getSource?.('atlas-route');
    const remainingLayer =
      this.map.getLayer?.('atlas-route-remaining');
    const casingLayer =
      this.map.getLayer?.('atlas-route-casing');

    // Nothing to do when the currently loaded style already contains the
    // complete Atlas route overlay.
    if (routeSource && remainingLayer && casingLayer) {
      return;
    }

    this.restoringStyleOverlays = true;

    try {
      // Remove any partial overlay left by an interrupted style transition.
      for (const layerId of [
        'atlas-route-traveled',
        'atlas-route-remaining',
        'atlas-route-casing'
      ]) {
        if (this.map.getLayer?.(layerId)) {
          this.map.removeLayer(layerId);
        }
      }

      for (const sourceId of [
        'atlas-route-traveled',
        'atlas-route'
      ]) {
        if (this.map.getSource?.(sourceId)) {
          this.map.removeSource(sourceId);
        }
      }

      // Reuse the exact normal route renderer. fitRoute() is suppressed while
      // restoring so pressing Start does not unexpectedly reset the camera.
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
