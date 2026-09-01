import { MapLibreMapAdapter } from './maplibre-map-adapter.js';

const originalUpdateUserLocation =
  MapLibreMapAdapter.prototype.updateUserLocation;

const MIN_HEADING_SPEED_METERS_PER_SECOND = 0.8;

function navigationIsActive() {
  return document.querySelector('.app')?.classList.contains('navigation-active') === true;
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
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
    const headingValid =
      Number.isFinite(position?.heading) &&
      Number.isFinite(position?.speed) &&
      position.speed >= MIN_HEADING_SPEED_METERS_PER_SECOND;

    this.userMarkerElement.className = 'maplibre-user-marker';

    if (headingValid) {
      this.userMarkerElement.innerHTML = `
        <span class="maplibre-user-heading" style="transform:rotate(${normalizeBearing(position.heading)}deg)">
          <span class="maplibre-user-arrow"></span>
        </span>
      `;
    } else {
      this.userMarkerElement.innerHTML =
        '<span class="maplibre-user-dot"></span>';
    }
  }

  return result;
};
