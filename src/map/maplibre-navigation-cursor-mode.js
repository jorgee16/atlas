import { MapLibreMapAdapter } from './maplibre-map-adapter.js';

const originalUpdateUserLocation =
  MapLibreMapAdapter.prototype.updateUserLocation;
const originalFollowPosition =
  MapLibreMapAdapter.prototype.followPosition;

const MIN_HEADING_SPEED_METERS_PER_SECOND = 0.8;

function navigationIsActive() {
  return document.querySelector('.app')?.classList.contains('navigation-active') === true;
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function enforceActiveDriveCursor(adapter) {
  const element = adapter.userMarkerElement;
  if (
    !element ||
    adapter.navigationTravelMode !== 'drive' ||
    !navigationIsActive()
  ) {
    return;
  }

  element.className = 'maplibre-user-marker drive';

  // The base MapLibre adapter rebuilds the drive marker during GPS/follow
  // updates. Map gestures can therefore briefly expose the older circular
  // drive styling before the navigation stylesheet is reapplied. Keep the
  // active-navigation cursor invariant at the DOM level so zoom/pan cannot
  // resurrect the white badge.
  Object.assign(element.style, {
    display: 'grid',
    width: '34px',
    height: '38px',
    placeItems: 'center',
    border: '0',
    borderRadius: '0',
    background: 'transparent',
    boxShadow: 'none',
    filter: 'drop-shadow(0 2px 3px rgba(20, 30, 48, .35))'
  });

  const headingElement = element.querySelector('.maplibre-user-heading');
  if (headingElement) {
    Object.assign(headingElement.style, {
      display: 'grid',
      width: '34px',
      height: '38px',
      placeItems: 'center'
    });
  }
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
    this.userMarkerElement.removeAttribute('style');

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
  } else {
    enforceActiveDriveCursor(this);
  }

  return result;
};

MapLibreMapAdapter.prototype.followPosition = function patchedFollowPosition(
  position,
  options = {}
) {
  const result = originalFollowPosition.call(this, position, options);
  enforceActiveDriveCursor(this);
  return result;
};
