import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const GESTURE_SETTLE_MS = 420;

export function installMapLibreTouchZoom(adapter) {
  const map = adapter?.map;
  const container = map?.getContainer?.();
  if (!map || !container || adapter.__atlasTouchZoomInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasTouchZoomInstalled', { value: true });

  // Dedicate two-finger gestures to zoom. Rotation/pitch during the same
  // gesture makes Android pinch feel heavy and is unnecessary because Atlas
  // already owns heading-up/north-up explicitly.
  map.touchZoomRotate?.enable?.();
  map.touchZoomRotate?.disableRotation?.();
  map.touchPitch?.disable?.();
  map.dragRotate?.disable?.();

  let settleTimer = null;

  const startManualGesture = event => {
    if ((event?.touches?.length ?? 0) < 2) return;

    // Cancel any navigation easeTo immediately. Otherwise MapLibre is trying
    // to interpolate the follow camera while the user's fingers are changing
    // zoom, which feels like input latency / resistance.
    map.stop?.();
    adapter.__atlasManualMapGesture = true;

    clearTimeout(settleTimer);
    settleTimer = null;
  };

  const finishManualGesture = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      adapter.__atlasManualMapGesture = false;
      settleTimer = null;
    }, GESTURE_SETTLE_MS);
  };

  container.addEventListener('touchstart', startManualGesture, {
    passive: true
  });
  container.addEventListener('touchend', finishManualGesture, {
    passive: true
  });
  container.addEventListener('touchcancel', finishManualGesture, {
    passive: true
  });

  map.on?.('zoomstart', event => {
    if (event?.originalEvent) {
      map.stop?.();
      adapter.__atlasManualMapGesture = true;
    }
  });
  map.on?.('zoomend', event => {
    if (event?.originalEvent) finishManualGesture();
  });

  container.classList.add('atlas-direct-touch-zoom');
  return adapter;
}

const prototype = MapLibrePmtilesMapAdapter?.prototype;
if (prototype && !prototype.__atlasDirectTouchZoomInstalled) {
  Object.defineProperty(prototype, '__atlasDirectTouchZoomInstalled', {
    value: true
  });

  const originalSetRegion = prototype.setRegion;
  prototype.setRegion = async function setRegion(region, options = {}) {
    installMapLibreTouchZoom(this);
    return originalSetRegion.call(this, region, options);
  };

  const originalSetNavigationTravelMode = prototype.setNavigationTravelMode;
  prototype.setNavigationTravelMode = function setNavigationTravelMode(mode = null) {
    installMapLibreTouchZoom(this);
    return originalSetNavigationTravelMode.call(this, mode);
  };
}
