import { MapLibreMapAdapter } from './maplibre-map-adapter.js';

const originalUpdateUserLocation =
  MapLibreMapAdapter.prototype.updateUserLocation;

function navigationIsActive() {
  return document.querySelector('.app')?.classList.contains('navigation-active') === true;
}

MapLibreMapAdapter.prototype.updateUserLocation = function patchedUpdateUserLocation(
  position,
  firstFix = false
) {
  const result = originalUpdateUserLocation.call(this, position, firstFix);

  if (
    this.navigationTravelMode === 'drive' &&
    !navigationIsActive() &&
    this.userMarkerElement
  ) {
    // Drive is also the default planner mode, but that must not leak the
    // navigation cursor into ordinary map/planner use. Outside a live
    // navigation session show the standard GPS location dot instead.
    this.userMarkerElement.className = 'maplibre-user-marker';
    this.userMarkerElement.innerHTML =
      '<span class="maplibre-user-dot"></span>';
  }

  return result;
};
