export class MapController {
  constructor({ adapter }) {
    if (!adapter) {
      throw new TypeError('MapController requires a map adapter.');
    }

    this.adapter = adapter;
  }

  clearItinerary() {
    this.adapter.clearItinerary();
  }

  clearNearby() {
    this.adapter.clearNearby();
  }

  clearRoute() {
    this.adapter.clearRoute();
  }

  showItinerary(places, onSelect) {
    this.adapter.showItinerary(places, onSelect);
  }

  focus(lat, lon, zoom = 16) {
    this.adapter.focus(lat, lon, zoom);
  }

  focusItineraryPlace(place, options = {}) {
    return this.adapter.focusItineraryPlace(
      place,
      options
    );
  }


  followPosition(position, options = {}) {
    return this.adapter.followPosition?.(
      position,
      options
    );
  }

  setBearing(bearing = 0) {
    return this.adapter.setBearing?.(bearing);
  }

  updateUserLocation(position, firstFix = false) {
    this.adapter.updateUserLocation(position, firstFix);
  }

  setNavigationTravelMode(mode = null) {
    return this.adapter.setNavigationTravelMode?.(mode);
  }

  setRegion(region, options = {}) {
    return this.adapter.setRegion(
      region,
      options
    );
  }

  addNearby(place, popupHtml) {
    this.adapter.addNearby(place, popupHtml);
  }

  showRoute(route, endpoints = {}) {
    this.adapter.showRoute(
      route,
      endpoints
    );
  }

  updateRouteProgress(route, progress) {
    this.adapter.updateRouteProgress?.(
      route,
      progress
    );
  }

  showManeuvers(
    maneuvers,
    activeIndex = 0
  ) {
    this.adapter.showManeuvers?.(
      maneuvers,
      activeIndex
    );
  }

  invalidateSize() {
    this.adapter.invalidateSize();
  }

  onMoveEnd(callback) {
    this.adapter.onMoveEnd(callback);
  }

  onUserMoveStart(callback) {
    this.adapter.onUserMoveStart(callback);
  }

  onMapClick(callback) {
    this.adapter.onMapClick(callback);
  }

  showSelectionPin(
    lat,
    lon,
    popupContent = null
  ) {
    this.adapter.showSelectionPin(
      lat,
      lon,
      popupContent
    );
  }

  clearSelectionPin() {
    this.adapter.clearSelectionPin();
  }

  closeSelectionPopup() {
    this.adapter.closeSelectionPopup();
  }
}
