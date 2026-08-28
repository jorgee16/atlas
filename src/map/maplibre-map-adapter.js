const DEFAULT_CENTER = [-8.0, 39.5];
const DEFAULT_ZOOM = 7;
const DRIVING_ZOOM = 18;
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
    Math.min(points.length - 1, Number.isInteger(progress.segmentIndex) ? progress.segmentIndex : 0)
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
    Math.min(points.length - 2, Number.isInteger(progress.segmentIndex) ? progress.segmentIndex : 0)
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
    if (!maplibre?.Map || !maplibre?.Marker || !maplibre?.Popup || !maplibre?.LngLatBounds) {
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
    this.routeBearing = null;
    this.navigationTravelMode = null;
    this.gpsDiagnosticsVisible = false;

    this.gpsDiagnosticsElement = document.createElement('div');
    this.gpsDiagnosticsElement.className = 'atlas-gps-diagnostics';
    this.gpsDiagnosticsElement.hidden = true;
    this.gpsDiagnosticsElement.innerHTML = '<strong>GPS diagnostics</strong><span>Renderer MapLibre</span>';
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
    this.#whenStyleReady(() => {
      for (const layerId of ['atlas-route-traveled', 'atlas-route-remaining', 'atlas-route-casing']) {
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
      const element = createElement('maplibre-itinerary-marker', String(index + 1));
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
    this.map.panBy([
      0,
      Math.max(120, Math.round(this.map.getContainer().clientHeight * 0.28))
    ], { duration: 0 });
    return true;
  }

  followPosition(position, { zoom = DRIVING_ZOOM, headingUp = false } = {}) {
    const lat = position?.latitude ?? position?.lat;
    const lon = position?.longitude ?? position?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
    const heading = Number.isFinite(position?.heading) ? position.heading : this.routeBearing;
    const bearing = headingUp && Number.isFinite(heading) ? normalizeBearing(heading) : 0;
    this.map.easeTo({
      center: [lon, lat],
      zoom: headingUp ? zoom : 16,
      bearing,
      duration: 220,
      essential: true
    });
    return bearing;
  }

  setBearing(bearing = 0) {
    const normalized = normalizeBearing(bearing);
    this.map.rotateTo(normalized, { duration: 180 });
    return normalized;
  }

  updateUserLocation({ latitude, longitude, heading = null, speed = null }, firstFix = false) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const drive = this.navigationTravelMode === 'drive';
    const element = createElement(drive ? 'maplibre-user-marker drive' : 'maplibre-user-marker');
    element.innerHTML = drive
      ? '<span class="maplibre-user-arrow"></span>'
      : '<span class="maplibre-user-dot"></span>';
    if (Number.isFinite(heading) && Number.isFinite(speed) && speed >= 0.8) {
      element.style.transform = `rotate(${normalizeBearing(heading)}deg)`;
    }
    this.userMarker?.remove();
    this.userMarker = new this.maplibre.Marker({ element, anchor: 'center' })
      .setLngLat([longitude, latitude])
      .addTo(this.map);
    if (firstFix) this.map.jumpTo({ center: [longitude, latitude], zoom: 16 });
  }

  setNavigationTravelMode(mode = null) {
    if (mode !== null && mode !== 'drive' && mode !== 'walk') {
      throw new TypeError('Navigation travel mode must be drive, walk, or null.');
    }
    this.navigationTravelMode = mode;
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
    this.gpsDiagnosticsElement.innerHTML = '<strong>GPS diagnostics</strong><span>Renderer MapLibre</span>';
  }

  async setRegion(region, { preferOffline = false } = {}) {
    const mapUrl = region?.mapUrl ?? region?.assets?.map ?? null;
    if (!preferOffline || !mapUrl) {
      this.map.setStyle(ONLINE_STYLE);
      return Boolean(mapUrl);
    }
    if (typeof this.createOfflineStyle !== 'function') {
      console.warn('MapLibre offline PMTiles style is not configured; keeping online map.');
      return false;
    }
    const offlineStyle = await this.createOfflineStyle({ region, url: mapUrl, maplibre: this.maplibre });
    if (!offlineStyle) return false;
    this.map.setStyle(offlineStyle);
    return true;
  }

  addNearby(place, popupHtml) {
    if (!validPoint(place)) return;
    const element = createElement('maplibre-nearby-marker');
    const popup = new this.maplibre.Popup({ offset: 12 }).setHTML(popupHtml ?? '');
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
      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: collection([lineFeature(points)])
      });
      this.map.addLayer({
        id: 'atlas-route-casing',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.92 }
      });
      this.map.addLayer({
        id: 'atlas-route-remaining',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#315efb', 'line-width': 5, 'line-opacity': 0.96 }
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
    const split = splitRoute(points, progress);
    this.routeBearing = routeBearing(points, progress);
    this.#whenStyleReady(() => {
      this.map.getSource(ROUTE_SOURCE)?.setData(collection([lineFeature(split.remaining)]));
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
          paint: { 'line-color': '#737b8c', 'line-width': 5, 'line-opacity': 0.88 }
        });
      } else {
        this.map.getSource(TRAVELED_SOURCE).setData(collection([lineFeature(split.traveled)]));
      }
    });
  }

  showManeuvers(maneuvers, activeIndex = 0) {
    this.clearManeuvers();
    if (!Array.isArray(maneuvers)) return;
    maneuvers
      .slice(Math.max(0, activeIndex))
      .filter(maneuver => maneuver?.type !== 'depart' && validPoint(maneuver?.location))
      .slice(0, 3)
      .forEach((maneuver, index) => {
        const element = createElement(`route-maneuver-marker${index === 0 ? ' active' : ''}`, '↗');
        const marker = new this.maplibre.Marker({ element, anchor: 'center' })
          .setLngLat([maneuver.location.lon, maneuver.location.lat])
          .addTo(this.map);
        this.maneuverMarkers.push(marker);
      });
  }

  invalidateSize() {
    this.map.resize();
  }

  onMoveEnd(callback) {
    if (typeof callback !== 'function') throw new TypeError('onMoveEnd requires a callback.');
    this.map.on('moveend', () => {
      const center = this.map.getCenter();
      callback({ lat: center.lat, lon: center.lng, zoom: this.map.getZoom() });
    });
  }

  onUserMoveStart(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onUserMoveStart requires a callback.');
    }
    for (const eventName of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
      this.map.on(eventName, event => {
        if (event?.originalEvent) callback(event);
      });
    }
  }

  onMapClick(callback) {
    if (typeof callback !== 'function') throw new TypeError('onMapClick requires a callback.');
    this.map.on('click', event => callback({ lat: event.lngLat.lat, lon: event.lngLat.lng }));
  }

  showSelectionPin(lat, lon, popupContent = null) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new TypeError('showSelectionPin requires lat and lon.');
    }
    if (!this.selectionMarker) {
      const element = createElement('bookmark-selection-pin');
      this.selectionMarker = new this.maplibre.Marker({ element, anchor: 'bottom' })
        .setLngLat([lon, lat])
        .addTo(this.map);
    } else {
      this.selectionMarker.setLngLat([lon, lat]);
    }
    if (popupContent) {
      this.selectionPopup?.remove();
      this.selectionPopup = new this.maplibre.Popup({ offset: 18 });
      if (typeof popupContent === 'string') this.selectionPopup.setHTML(popupContent);
      else this.selectionPopup.setDOMContent(popupContent);
      this.selectionMarker.setPopup(this.selectionPopup);
      this.selectionPopup.addTo(this.map);
    }
  }

  clearSelectionPin() {
    this.selectionPopup?.remove();
    this.selectionPopup = null;
    this.selectionMarker?.remove();
    this.selectionMarker = null;
  }

  closeSelectionPopup() {
    this.selectionPopup?.remove();
  }

  #whenStyleReady(callback) {
    if (this.map.isStyleLoaded?.()) callback();
    else this.map.once('load', callback);
  }

  #fitPoints(points, maxZoom) {
    if (points.length === 1) {
      this.map.easeTo({ center: [points[0].lon, points[0].lat], zoom: maxZoom, duration: 250 });
      return;
    }
    const first = [points[0].lon, points[0].lat];
    const bounds = new this.maplibre.LngLatBounds(first, first);
    for (const point of points.slice(1)) bounds.extend([point.lon, point.lat]);
    this.map.fitBounds(bounds, {
      padding: { top: 112, right: 28, bottom: 196, left: 28 },
      maxZoom,
      duration: 350
    });
  }

  #removeMarkers(markers) {
    for (const marker of markers) marker?.remove?.();
  }
}
