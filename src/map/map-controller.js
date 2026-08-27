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

  constructor({ adapter }) {
    this.#adapter =
      assertMapAdapterContract(adapter);
  }

  clearItinerary() {
    return this.#adapter.clearItinerary();
  }

  clearNearby() {
    return this.#adapter.clearNearby();
  }

  clearRoute() {
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
    return this.#adapter.followPosition(
      position,
      options
    );
  }

  setBearing(bearing = 0) {
    return this.#adapter.setBearing(bearing);
  }

  updateUserLocation(position, firstFix = false) {
    return this.#adapter.updateUserLocation(
      position,
      firstFix
    );
  }

  setNavigationTravelMode(mode = null) {
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
    return this.#adapter.updateRouteProgress(
      route,
      progress
    );
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
