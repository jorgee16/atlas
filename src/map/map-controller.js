export const MAP_ADAPTER_METHODS = Object.freeze([
  'clearItinerary',
  'clearNearby',
  'clearRoute',
  'clearManeuvers',
  'showItinerary',
  'focus',
  'focusItineraryPlace',
  'followPosition',
  'setBearing',
  'updateUserLocation',
  'setNavigationTravelMode',
  'setGpsDiagnosticsVisible',
  'isGpsDiagnosticsVisible',
  'resetGpsDiagnostics',
  'setRegion',
  'addNearby',
  'showRoute',
  'fitRoute',
  'updateRouteProgress',
  'showManeuvers',
  'invalidateSize',
  'onMoveEnd',
  'onUserMoveStart',
  'onMapClick',
  'showSelectionPin',
  'clearSelectionPin',
  'closeSelectionPopup'
]);

const DISPLAY_OFF_ROUTE_DISTANCE_METERS = 50;
const DISPLAY_OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5;
const DISPLAY_REDUCED_ACCURACY_METERS = 80;
const DISPLAY_OFF_ROUTE_CONFIRMATION_FIXES = 3;
const WRONG_WAY_MIN_SPEED_METERS_PER_SECOND = 2.5;
const WRONG_WAY_HEADING_DELTA_DEGREES = 135;
const WRONG_WAY_CONFIRMATION_FIXES = 2;
const WRONG_WAY_RECOVERY_DELTA_DEGREES = 90;

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function headingDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const delta = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(delta, 360 - delta);
}

function progressSegmentIndex(progress = {}) {
  return Number.isInteger(progress.pointIndex)
    ? progress.pointIndex
    : Number.isInteger(progress.segmentIndex)
      ? progress.segmentIndex
      : 0;
}

function routeMatchedPosition(route, progress, sourcePosition) {
  const points = route?.points ?? [];
  if (points.length < 1 || !progress) return sourcePosition;

  const index = Math.max(
    0,
    Math.min(points.length - 1, progressSegmentIndex(progress))
  );
  const current = points[index];
  const next = points[index + 1] ?? current;
  if (
    !Number.isFinite(current?.lat) ||
    !Number.isFinite(current?.lon) ||
    !Number.isFinite(next?.lat) ||
    !Number.isFinite(next?.lon)
  ) {
    return sourcePosition;
  }

  const fraction = Number.isFinite(progress.segmentFraction)
    ? Math.max(0, Math.min(1, progress.segmentFraction))
    : 0;
  const latitude =
    current.lat + (next.lat - current.lat) * fraction;
  const longitude =
    current.lon + (next.lon - current.lon) * fraction;

  return {
    ...sourcePosition,
    latitude,
    longitude,
    lat: latitude,
    lon: longitude
  };
}

function routeBearing(route, progress) {
  const points = route?.points ?? [];
  if (points.length < 2 || !progress) return null;

  const index = Math.max(
    0,
    Math.min(points.length - 2, progressSegmentIndex(progress))
  );
  const from = points[index];
  const to = points[index + 1];
  if (
    !Number.isFinite(from?.lat) ||
    !Number.isFinite(from?.lon) ||
    !Number.isFinite(to?.lat) ||
    !Number.isFinite(to?.lon)
  ) {
    return null;
  }

  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

export function assertMapAdapterContract(adapter) {
  if (!adapter) {
    throw new TypeError(
      'MapController requires a map adapter.'
    );
  }

  const missing = MAP_ADAPTER_METHODS.filter(
    method =>
      typeof adapter[method] !== 'function'
  );

  if (missing.length > 0) {
    throw new TypeError(
      `Map adapter is missing required methods: ${missing.join(', ')}`
    );
  }

  return adapter;
}

export class MapController {
  #adapter;
  #mapLibreNavigationDisplay;
  #navigationTravelMode = null;
  #navigationRoute = null;
  #navigationRouteProgress = null;
  #lastRawPosition = null;
  #displayRouteLocked = true;
  #offRouteDisplayEvidence = 0;
  #wrongWayEvidence = 0;
  #wrongWayConfirmed = false;

  constructor({ adapter }) {
    this.#adapter =
      assertMapAdapterContract(adapter);

    // Keep this behavior isolated to MapLibre while the alternate renderer
    // is being proven. Leaflet continues to receive raw GPS coordinates.
    this.#mapLibreNavigationDisplay = Boolean(adapter.maplibre);
  }

  #usesRouteLockedCursor() {
    // Driving benefits from a map-matched cursor. Walking does not: people can
    // legitimately be on a pavement, path, forecourt or the opposite side of
    // a road, so forcing the marker onto the route makes the map feel wrong.
    return (
      this.#mapLibreNavigationDisplay &&
      this.#navigationTravelMode === 'drive'
    );
  }

  #resetNavigationDisplayMatch() {
    this.#navigationRoute = null;
    this.#navigationRouteProgress = null;
    this.#displayRouteLocked = true;
    this.#offRouteDisplayEvidence = 0;
    this.#wrongWayEvidence = 0;
    this.#wrongWayConfirmed = false;
  }

  #displayPosition(position) {
    if (
      !this.#usesRouteLockedCursor() ||
      !this.#navigationRouteProgress ||
      !this.#displayRouteLocked
    ) {
      return position;
    }

    return routeMatchedPosition(
      this.#navigationRoute,
      this.#navigationRouteProgress,
      position
    );
  }

  #updateNavigationDisplayConfidence(progress) {
    if (!this.#usesRouteLockedCursor() || !this.#lastRawPosition) {
      return;
    }

    const raw = this.#lastRawPosition;
    const distanceFromRoute = progress?.distanceFromRouteMeters;
    const accuracy = raw.accuracy;
    const reducedAccuracy =
      Number.isFinite(accuracy) &&
      accuracy > DISPLAY_REDUCED_ACCURACY_METERS;

    const expectedBearing = routeBearing(
      this.#navigationRoute,
      progress
    );
    const directionDelta = headingDelta(raw.heading, expectedBearing);
    const movingFastEnough =
      Number.isFinite(raw.speed) &&
      raw.speed >= WRONG_WAY_MIN_SPEED_METERS_PER_SECOND;
    const reliableDirection =
      movingFastEnough &&
      !reducedAccuracy &&
      Number.isFinite(directionDelta);

    if (
      reliableDirection &&
      directionDelta >= WRONG_WAY_HEADING_DELTA_DEGREES
    ) {
      this.#wrongWayEvidence += 1;
      if (this.#wrongWayEvidence >= WRONG_WAY_CONFIRMATION_FIXES) {
        this.#wrongWayConfirmed = true;
        this.#displayRouteLocked = false;
      }
    } else if (
      !reliableDirection ||
      directionDelta <= WRONG_WAY_RECOVERY_DELTA_DEGREES
    ) {
      this.#wrongWayEvidence = 0;
      this.#wrongWayConfirmed = false;
    }

    if (reducedAccuracy || !Number.isFinite(distanceFromRoute)) {
      this.#offRouteDisplayEvidence = 0;
      return;
    }

    const offRouteThreshold = Math.max(
      DISPLAY_OFF_ROUTE_DISTANCE_METERS,
      Number.isFinite(accuracy)
        ? accuracy * DISPLAY_OFF_ROUTE_ACCURACY_MULTIPLIER
        : 0
    );

    if (distanceFromRoute <= offRouteThreshold) {
      this.#offRouteDisplayEvidence = 0;
      if (!this.#wrongWayConfirmed) {
        this.#displayRouteLocked = true;
      }
      return;
    }

    this.#offRouteDisplayEvidence += 1;
    if (
      this.#offRouteDisplayEvidence >=
      DISPLAY_OFF_ROUTE_CONFIRMATION_FIXES
    ) {
      this.#displayRouteLocked = false;
    }
  }

  clearItinerary() {
    return this.#adapter.clearItinerary();
  }

  clearNearby() {
    return this.#adapter.clearNearby();
  }

  clearRoute() {
    this.#resetNavigationDisplayMatch();
    return this.#adapter.clearRoute();
  }

  clearManeuvers() {
    return this.#adapter.clearManeuvers();
  }

  showItinerary(places, onSelect) {
    return this.#adapter.showItinerary(
      places,
      onSelect
    );
  }

  focus(lat, lon, zoom = 16) {
    return this.#adapter.focus(lat, lon, zoom);
  }

  focusItineraryPlace(place, options = {}) {
    return this.#adapter.focusItineraryPlace(
      place,
      options
    );
  }

  followPosition(position, options = {}) {
    const displayPosition = this.#displayPosition(position);
    return this.#adapter.followPosition(
      displayPosition,
      options
    );
  }

  setBearing(bearing = 0) {
    return this.#adapter.setBearing(bearing);
  }

  updateUserLocation(position, firstFix = false) {
    this.#lastRawPosition = position;
    const displayPosition = this.#displayPosition(position);
    return this.#adapter.updateUserLocation(
      displayPosition,
      firstFix
    );
  }

  setNavigationTravelMode(mode = null) {
    this.#navigationTravelMode = mode;
    if (mode !== 'drive') {
      this.#displayRouteLocked = false;
      this.#offRouteDisplayEvidence = 0;
      this.#wrongWayEvidence = 0;
      this.#wrongWayConfirmed = false;
    } else {
      this.#displayRouteLocked = true;
    }

    return this.#adapter.setNavigationTravelMode(
      mode
    );
  }

  setGpsDiagnosticsVisible(visible) {
    return this.#adapter.setGpsDiagnosticsVisible(
      visible
    );
  }

  isGpsDiagnosticsVisible() {
    return this.#adapter.isGpsDiagnosticsVisible();
  }

  resetGpsDiagnostics() {
    return this.#adapter.resetGpsDiagnostics();
  }

  setRegion(region, options = {}) {
    return this.#adapter.setRegion(
      region,
      options
    );
  }

  addNearby(place, popupHtml) {
    return this.#adapter.addNearby(
      place,
      popupHtml
    );
  }

  showRoute(route, endpoints = {}) {
    if (this.#mapLibreNavigationDisplay) {
      this.#navigationRoute = route;
      this.#navigationRouteProgress = null;
      this.#displayRouteLocked = this.#navigationTravelMode === 'drive';
      this.#offRouteDisplayEvidence = 0;
      this.#wrongWayEvidence = 0;
      this.#wrongWayConfirmed = false;
    }

    return this.#adapter.showRoute(
      route,
      endpoints
    );
  }

  fitRoute(route, options = {}) {
    return this.#adapter.fitRoute(
      route,
      options
    );
  }

  updateRouteProgress(route, progress) {
    if (this.#mapLibreNavigationDisplay) {
      this.#navigationRoute = route;
      this.#navigationRouteProgress = progress ?? null;
      this.#updateNavigationDisplayConfidence(progress);
    }

    const result = this.#adapter.updateRouteProgress(
      route,
      progress
    );

    // Driving GPS arrives before NavigationFeature calculates the latest
    // progress. Correct the map-matched car cursor immediately afterwards.
    // Walking deliberately keeps the raw GPS position, so it gets no second
    // route-correction write here.
    if (
      this.#usesRouteLockedCursor() &&
      this.#lastRawPosition &&
      this.#navigationRouteProgress
    ) {
      this.#adapter.updateUserLocation(
        this.#displayPosition(this.#lastRawPosition),
        false
      );
    }

    return result;
  }

  showManeuvers(
    maneuvers,
    activeIndex = 0
  ) {
    return this.#adapter.showManeuvers(
      maneuvers,
      activeIndex
    );
  }

  invalidateSize() {
    return this.#adapter.invalidateSize();
  }

  onMoveEnd(callback) {
    return this.#adapter.onMoveEnd(callback);
  }

  onUserMoveStart(callback) {
    return this.#adapter.onUserMoveStart(
      callback
    );
  }

  onMapClick(callback) {
    return this.#adapter.onMapClick(callback);
  }

  showSelectionPin(
    lat,
    lon,
    popupContent = null
  ) {
    return this.#adapter.showSelectionPin(
      lat,
      lon,
      popupContent
    );
  }

  clearSelectionPin() {
    return this.#adapter.clearSelectionPin();
  }

  closeSelectionPopup() {
    return this.#adapter.closeSelectionPopup();
  }
}
