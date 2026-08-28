import {
  adaptiveNavigationZoom,
  navigationForwardOffset
} from './navigation-camera.js';
import {
  carNavigationHeading,
  smoothHeading
} from './navigation-heading.js';

const DEFAULT_CENTER = [-8.0, 39.5];
const DEFAULT_ZOOM = 7;
const DRIVING_ZOOM = 18;
const MIN_HEADING_SPEED_METERS_PER_SECOND = 0.8;
const ROUTE_SOURCE = 'atlas-route';
const TRAVELED_SOURCE = 'atlas-route-traveled';

const ONLINE_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function smoothingFactor(rate, deltaSeconds) {
  return 1 - Math.exp(-rate * deltaSeconds);
}

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function lineFeature(points) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map(point => [point.lon, point.lat])
    }
  };
}

function collection(features) {
  return { type: 'FeatureCollection', features };
}

function splitRoute(points, progress = {}) {
  const segmentIndex = Math.max(
    0,
    Math.min(
      points.length - 1,
      Number.isInteger(progress.segmentIndex)
        ? progress.segmentIndex
        : 0
    )
  );
  const fraction = Number.isFinite(progress.segmentFraction)
    ? Math.max(0, Math.min(1, progress.segmentFraction))
    : 0;
  const current = points[segmentIndex];
  const next = points[segmentIndex + 1] ?? current;
  const interpolated = {
    lat: current.lat + (next.lat - current.lat) * fraction,
    lon: current.lon + (next.lon - current.lon) * fraction
  };
  return {
    traveled: [...points.slice(0, segmentIndex + 1), interpolated],
    remaining: [interpolated, ...points.slice(segmentIndex + 1)]
  };
}

function routeBearing(points, progress = {}) {
  if (points.length < 2) return null;
  const index = Math.max(
    0,
    Math.min(
      points.length - 2,
      Number.isInteger(progress.segmentIndex)
        ? progress.segmentIndex
        : 0
    )
  );
  const from = points[index];
  const to = points[index + 1];
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

function createElement(className, text = '') {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function setUserMarkerAppearance(element, { drive, heading, showHeading }) {
  element.className = drive
    ? 'maplibre-user-marker drive'
    : 'maplibre-user-marker';

  if (drive) {
    element.innerHTML = `
      <span class="maplibre-user-heading" style="transform:rotate(${normalizeBearing(heading ?? 0)}deg)">
        <span class="maplibre-user-arrow"></span>
      </span>
    `;
    return;
  }

  if (showHeading) {
    element.innerHTML = `
      <span class="maplibre-user-heading" style="transform:rotate(${normalizeBearing(heading ?? 0)}deg)">
        <span class="maplibre-user-arrow"></span>
      </span>
    `;
  } else {
    element.innerHTML = '<span class="maplibre-user-dot"></span>';
  }
}

export class MapLibreMapAdapter {
  constructor({
    elementId,
    maplibre = globalThis.maplibregl,
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    style = ONLINE_STYLE,
    mapOptions = {},
    createOfflineStyle = null
  } = {}) {
    if (!elementId) {
      throw new TypeError('MapLibreMapAdapter requires a map element id.');
    }
    if (
      !maplibre?.Map ||
      !maplibre?.Marker ||
      !maplibre?.Popup ||
      !maplibre?.LngLatBounds
    ) {
      throw new TypeError(
        'MapLibreMapAdapter requires a MapLibre GL compatible implementation.'
      );
    }

    this.maplibre = maplibre;
    this.createOfflineStyle = createOfflineStyle;
    this.map = new maplibre.Map({
      container: elementId,
      center,
      zoom,
      style,
      attributionControl: true,
      ...mapOptions
    });

    this.itineraryMarkers = [];
    this.nearbyMarkers = [];
    this.maneuverMarkers = [];
    this.selectionMarker = null;
    this.selectionPopup = null;
    this.userMarker = null;
    this.userMarkerElement = null;
    this.routeBearing = null;
    this.navigationRouteProgress = null;
    this.navigationTravelMode = null;
    this.navigationCameraZoom = null;
    this.navigationCameraTimestamp = null;
    this.navigationCameraHeading = null;
    this.navigationHeadingTimestamp = null;
    this.lastUserPosition = null;
    this.gpsDiagnosticsVisible = false;

    this.gpsDiagnosticsElement = document.createElement('div');
    this.gpsDiagnosticsElement.className = 'atlas-gps-diagnostics';
    this.gpsDiagnosticsElement.hidden = true;
    this.gpsDiagnosticsElement.innerHTML =
      '<strong>GPS diagnostics</strong><span>Renderer MapLibre</span>';
    this.map.getContainer().appendChild(this.gpsDiagnosticsElement);
  }

  clearItinerary() {
    this.#removeMarkers(this.itineraryMarkers);
    this.itineraryMarkers = [];
  }

  clearNearby() {
    this.#removeMarkers(this.nearbyMarkers);
    this.nearbyMarkers = [];
  }

  clearRoute() {
    this.routeBearing = null;
    this.navigationRouteProgress = null;
    this.navigationCameraZoom = null;
    this.navigationCameraTimestamp = null;
    this.#whenStyleReady(() => {
      for (const layerId of [
        'atlas-route-traveled',
        'atlas-route-remaining',
        'atlas-route-casing'
      ]) {
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      }
      for (const sourceId of [TRAVELED_SOURCE, ROUTE_SOURCE]) {
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
      }
    });
  }

  clearManeuvers() {
    this.#removeMarkers(this.maneuverMarkers);
    this.maneuverMarkers = [];
  }

  showItinerary(places, onSelect) {
    this.clearItinerary();
    const validPlaces = (places ?? []).filter(validPoint);

    validPlaces.forEach((place, index) => {
      const element = createElement('maplibre-itinerary-marker');
      element.innerHTML =
        `<span class="maplibre-itinerary-marker-shape"><span>${index + 1}</span></span>`;
      const marker = new this.maplibre.Marker({ element, anchor: 'bottom' })
        .setLngLat([place.lon, place.lat])
        .addTo(this.map);
      element.addEventListener('click', event => {
        event.stopPropagation();
        onSelect?.(place, marker, index);
      });
      this.itineraryMarkers.push(marker);
    });

    if (validPlaces.length) this.#fitPoints(validPlaces, 16);
  }

  focus(lat, lon, zoom = 16) {
    this.map.jumpTo({ center: [lon, lat], zoom });
  }

  focusItineraryPlace(place, { zoom = 16 } = {}) {
    if (!validPoint(place)) return false;
    this.map.jumpTo({ center: [place.lon, place.lat], zoom });
    this.map.panBy(
      [0, Math.max(120, Math.round(this.map.getContainer().clientHeight * 0.28))],
      { duration: 0 }
    );
    return true;
  }

  followPosition(
    position,
    { zoom = DRIVING_ZOOM, headingUp = false } = {}
  ) {
    const lat = position?.latitude ?? position?.lat;
    const lon = position?.longitude ?? position?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;

    const gpsHeading =
      Number.isFinite(position?.heading) &&
      (!Number.isFinite(position?.speed) ||
        position.speed >= MIN_HEADING_SPEED_METERS_PER_SECOND)
        ? normalizeBearing(position.heading)
        : null;

    const now = performance.now();
    let heading = gpsHeading ?? this.routeBearing;

    if (this.navigationTravelMode === 'drive') {
      const fusedTarget = carNavigationHeading({
        gpsHeading,
        routeHeading: this.routeBearing,
        speed: position?.speed,
        accuracy: this.lastUserPosition?.accuracy,
        distanceFromRouteMeters:
          this.navigationRouteProgress?.distanceFromRouteMeters
      });

      const elapsedSeconds =
        this.navigationHeadingTimestamp === null
          ? 0.25
          : Math.min(
              1,
              Math.max(
                0.05,
                (now - this.navigationHeadingTimestamp) / 1000
              )
            );
      const headingEase = Math.min(
        0.72,
        Math.max(0.28, smoothingFactor(2.8, elapsedSeconds))
      );
      this.navigationCameraHeading = smoothHeading(
        this.navigationCameraHeading,
        fusedTarget,
        headingEase
      );
      this.navigationHeadingTimestamp = now;
      heading = this.navigationCameraHeading;
    } else {
      this.navigationCameraHeading = null;
      this.navigationHeadingTimestamp = null;
    }

    const bearing =
      headingUp && Number.isFinite(heading)
        ? normalizeBearing(heading)
        : 0;

    const requestedZoom = this.navigationTravelMode
      ? adaptiveNavigationZoom({
          travelMode: this.navigationTravelMode,
          speed: position?.speed,
          preferredZoom: zoom,
          progress: this.navigationRouteProgress
        })
      : headingUp
        ? zoom
        : 16;

    if (this.navigationCameraZoom === null) {
      this.navigationCameraZoom = requestedZoom;
    } else {
      const elapsedSeconds =
        this.navigationCameraTimestamp === null
          ? 0.2
          : Math.min(
              0.5,
              Math.max(
                0.016,
                (now - this.navigationCameraTimestamp) / 1000
              )
            );
      this.navigationCameraZoom +=
        (requestedZoom - this.navigationCameraZoom) *
        smoothingFactor(2.6, elapsedSeconds);
    }
    this.navigationCameraTimestamp = now;

    const containerHeight = this.map.getContainer()?.clientHeight ?? 0;
    const forwardOffset = navigationForwardOffset({
      travelMode: this.navigationTravelMode,
      height: containerHeight,
      headingUp
    });

    this.map.easeTo({
      center: [lon, lat],
      zoom: this.navigationCameraZoom,
      bearing,
      pitch: this.navigationTravelMode === 'drive' && headingUp ? 42 : 0,
      offset: [0, forwardOffset],
      duration: this.navigationTravelMode === 'drive' ? 260 : 220,
      essential: true
    });

    return headingUp ? normalizeBearing(-bearing) : 0;
  }

  setBearing(bearing = 0) {
    const normalized = normalizeBearing(bearing);
    this.map.easeTo({
      bearing: normalized,
      pitch: normalized === 0 ? 0 : this.map.getPitch?.() ?? 0,
      duration: 180,
      essential: true
    });
    return normalized;
  }

  updateUserLocation(
    {
      latitude,
      longitude,
      accuracy,
      heading = null,
      speed = null
    },
    firstFix = false
  ) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    this.lastUserPosition = {
      latitude,
      longitude,
      accuracy,
      heading,
      speed
    };

    const drive = this.navigationTravelMode === 'drive';
    const showHeading =
      Number.isFinite(heading) &&
      Number.isFinite(speed) &&
      speed >= MIN_HEADING_SPEED_METERS_PER_SECOND;

    if (!this.userMarker) {
      this.userMarkerElement = createElement('maplibre-user-marker');
      setUserMarkerAppearance(this.userMarkerElement, {
        drive,
        heading,
        showHeading
      });
      this.userMarker = new this.maplibre.Marker({
        element: this.userMarkerElement,
        anchor: 'center'
      })
        .setLngLat([longitude, latitude])
        .addTo(this.map);
    } else {
      setUserMarkerAppearance(this.userMarkerElement, {
        drive,
        heading,
        showHeading
      });
      this.userMarker.setLngLat([longitude, latitude]);
    }

    if (firstFix) {
      this.map.jumpTo({ center: [longitude, latitude], zoom: 16 });
    }
  }

  setNavigationTravelMode(mode = null) {
    if (mode !== null && mode !== 'drive' && mode !== 'walk') {
      throw new TypeError(
        'Navigation travel mode must be drive, walk, or null.'
      );
    }

    if (this.navigationTravelMode !== mode) {
      this.navigationCameraZoom = null;
      this.navigationCameraTimestamp = null;
      this.navigationCameraHeading = null;
      this.navigationHeadingTimestamp = null;
    }

    this.navigationTravelMode = mode;
    this.map.getContainer()?.classList.toggle(
      'atlas-drive-camera',
      mode === 'drive'
    );

    if (this.userMarkerElement && this.lastUserPosition) {
      setUserMarkerAppearance(this.userMarkerElement, {
        drive: mode === 'drive',
        heading: this.lastUserPosition.heading,
        showHeading:
          Number.isFinite(this.lastUserPosition.heading) &&
          Number.isFinite(this.lastUserPosition.speed) &&
          this.lastUserPosition.speed >= MIN_HEADING_SPEED_METERS_PER_SECOND
      });
    }
  }

  setGpsDiagnosticsVisible(visible) {
    this.gpsDiagnosticsVisible = Boolean(visible);
    this.gpsDiagnosticsElement.hidden = !this.gpsDiagnosticsVisible;
    return this.gpsDiagnosticsVisible;
  }

  isGpsDiagnosticsVisible() {
    return this.gpsDiagnosticsVisible;
  }

  resetGpsDiagnostics() {
    this.gpsDiagnosticsElement.innerHTML =
      '<strong>GPS diagnostics</strong><span>Renderer MapLibre</span>';
  }

  async setRegion(region, { preferOffline = false } = {}) {
    const mapUrl = region?.mapUrl ?? region?.assets?.map ?? null;

    if (!preferOffline || !mapUrl) {
      this.map.setStyle(ONLINE_STYLE);
      return Boolean(mapUrl);
    }

    if (typeof this.createOfflineStyle !== 'function') {
      console.warn(
        'MapLibre offline PMTiles style is not configured; keeping online map.'
      );
      this.map.setStyle(ONLINE_STYLE);
      return false;
    }

    const resolvedUrl = this.#resolveAssetUrl(mapUrl);

    try {
      const offlineStyle = await this.createOfflineStyle({
        region,
        url: resolvedUrl,
        maplibre: this.maplibre
      });

      if (!offlineStyle) {
        this.map.setStyle(ONLINE_STYLE);
        return false;
      }

      this.map.setStyle(offlineStyle);
      return true;
    } catch (error) {
      console.warn(
        `Unable to load MapLibre offline map for ${region?.name ?? 'region'}; using online OpenStreetMap.`,
        error
      );
      this.map.setStyle(ONLINE_STYLE);
      return false;
    }
  }

  addNearby(place, popupHtml) {
    if (!validPoint(place)) return;
    const element = createElement('maplibre-nearby-marker');
    const popup = new this.maplibre.Popup({ offset: 12 }).setHTML(
      popupHtml ?? ''
    );
    const marker = new this.maplibre.Marker({ element, anchor: 'center' })
      .setLngLat([place.lon, place.lat])
      .setPopup(popup)
      .addTo(this.map);
    this.nearbyMarkers.push(marker);
  }

  showRoute(route) {
    const points = route?.points ?? [];
    if (points.length < 1 || points.some(point => !validPoint(point))) {
      throw new TypeError('showRoute requires valid route points.');
    }

    this.clearRoute();
    this.#whenStyleReady(() => {
      if (this.map.getSource(ROUTE_SOURCE)) return;
      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: collection([lineFeature(points)])
      });
      this.map.addLayer({
        id: 'atlas-route-casing',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 9,
          'line-opacity': 0.92
        }
      });
      this.map.addLayer({
        id: 'atlas-route-remaining',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#315efb',
          'line-width': 5,
          'line-opacity': 0.96
        }
      });
      this.fitRoute(route);
    });
  }

  fitRoute(route, { maxZoom = 16 } = {}) {
    const points = (route?.points ?? []).filter(validPoint);
    if (!points.length) return false;
    this.#fitPoints(points, maxZoom);
    return true;
  }

  updateRouteProgress(route, progress) {
    const points = route?.points ?? [];
    if (points.length < 2 || points.some(point => !validPoint(point))) return;

    this.navigationRouteProgress = progress ?? null;
    const split = splitRoute(points, progress);
    this.routeBearing = routeBearing(points, progress);

    this.#whenStyleReady(() => {
      this.map
        .getSource(ROUTE_SOURCE)
        ?.setData(collection([lineFeature(split.remaining)]));

      if (!this.map.getSource(TRAVELED_SOURCE)) {
        this.map.addSource(TRAVELED_SOURCE, {
          type: 'geojson',
          data: collection([lineFeature(split.traveled)])
        });
        this.map.addLayer({
          id: 'atlas-route-traveled',
          type: 'line',
          source: TRAVELED_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#737b8c',
            'line-width': 5,
            'line-opacity': 0.88
          }
        });
      } else {
        this.map
          .getSource(TRAVELED_SOURCE)
          .setData(collection([lineFeature(split.traveled)]));
      }
    });
  }

  showManeuvers(maneuvers, activeIndex = 0) {
    this.clearManeuvers();
    if (!Array.isArray(maneuvers)) return;

    const maneuver = maneuvers
      .slice(Math.max(0, activeIndex))
      .find(item => item?.type !== 'depart' && validPoint(item?.location));

    if (!maneuver) return;

    const element = createElement('route-maneuver-marker active', '↗');
    const marker = new this.maplibre.Marker({ element, anchor: 'center' })
      .setLngLat([maneuver.location.lon, maneuver.location.lat])
      .addTo(this.map);
    this.maneuverMarkers.push(marker);
  }

  invalidateSize() {
    this.map.resize();
  }

  onMoveEnd(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onMoveEnd requires a callback.');
    }
    this.map.on('moveend', () => {
      const center = this.map.getCenter();
      callback({
        lat: center.lat,
        lon: center.lng,
        zoom: this.map.getZoom()
      });
    });
  }

  onUserMoveStart(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onUserMoveStart requires a callback.');
    }
    for (const eventName of [
      'dragstart',
      'zoomstart',
      'rotatestart',
      'pitchstart'
    ]) {
      this.map.on(eventName, event => {
        if (event?.originalEvent) callback(event);
      });
    }
  }

  onMapClick(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onMapClick requires a callback.');
    }
    this.map.on('click', event => {
      if (!event?.lngLat) return;
      callback({
        lat: event.lngLat.lat,
        lon: event.lngLat.lng
      });
    });
  }

  showSelectionPin(lat, lon, popupContent = null) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new TypeError('showSelectionPin requires lat and lon.');
    }

    if (!this.selectionMarker) {
      const element = createElement('bookmark-selection-pin');
      element.innerHTML = '<span class="bookmark-selection-pin-shape"></span>';
      this.selectionMarker = new this.maplibre.Marker({
        element,
        anchor: 'bottom'
      })
        .setLngLat([lon, lat])
        .addTo(this.map);
    } else {
      this.selectionMarker.setLngLat([lon, lat]);
    }

    this.selectionPopup?.remove();
    this.selectionPopup = null;

    if (!popupContent) return;

    this.selectionPopup = new this.maplibre.Popup({
      offset: [0, -10],
      maxWidth: '224px',
      closeOnClick: false,
      focusAfterOpen: false
    }).setLngLat([lon, lat]);

    if (typeof popupContent === 'string') {
      this.selectionPopup.setHTML(popupContent);
    } else {
      this.selectionPopup.setDOMContent(popupContent);
    }

    this.selectionPopup.addTo(this.map);
  }

  clearSelectionPin() {
    this.selectionPopup?.remove();
    this.selectionPopup = null;
    this.selectionMarker?.remove();
    this.selectionMarker = null;
  }

  closeSelectionPopup() {
    this.selectionPopup?.remove();
    this.selectionPopup = null;
  }

  #resolveAssetUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    const relativeUrl = String(url).replace(/^\//, '');
    return `${import.meta.env.BASE_URL}${relativeUrl}`;
  }

  #whenStyleReady(callback) {
    if (this.map.isStyleLoaded?.()) {
      callback();
      return;
    }
    this.map.once('style.load', callback);
  }

  #fitPoints(points, maxZoom) {
    if (points.length === 1) {
      this.map.easeTo({
        center: [points[0].lon, points[0].lat],
        zoom: maxZoom,
        duration: 250
      });
      return;
    }

    const first = [points[0].lon, points[0].lat];
    const bounds = new this.maplibre.LngLatBounds(first, first);
    for (const point of points.slice(1)) {
      bounds.extend([point.lon, point.lat]);
    }

    const container = this.map.getContainer();
    const landscape =
      Number(container?.clientWidth ?? 0) >
      Number(container?.clientHeight ?? 0);

    this.map.fitBounds(bounds, {
      padding: landscape
        ? { top: 28, right: 32, bottom: 126, left: 32 }
        : { top: 112, right: 28, bottom: 196, left: 28 },
      maxZoom,
      duration: 350
    });
  }

  #removeMarkers(markers) {
    for (const marker of markers) marker?.remove?.();
  }
}
