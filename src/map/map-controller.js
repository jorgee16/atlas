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

  showItinerary(places, onSelect) {
    this.adapter.showItinerary(places, onSelect);
  }

  focus(lat, lon, zoom = 16) {
    this.adapter.focus(lat, lon, zoom);
  }

  updateUserLocation(position, firstFix = false) {
    this.adapter.updateUserLocation(position, firstFix);
  }

  addNearby(place, popupHtml) {
    this.adapter.addNearby(place, popupHtml);
  }

  invalidateSize() {
    this.adapter.invalidateSize();
  }
}
