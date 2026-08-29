import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const GESTURE_SETTLE_MS = 180;

export function installMapLibreTouchZoom(adapter) {
  const map = adapter?.map;
  const container = map?.getContainer?.();
  if (!map || !container || adapter.__atlasTouchZoomInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasTouchZoomInstalled', { value: true });

  // Let MapLibre's native touch handler own pinch scaling completely. Atlas
  // still disables rotation/pitch because heading is controlled explicitly by
  // north-up / heading-up, but we must not stop() the camera from inside a
  // touch/zoom event: doing that aborts MapLibre's own gesture interpolation
  // and makes pinch feel sticky or difficult to trigger.
  map.touchZoomRotate?.enable?.();
  map.touchZoomRotate?.disableRotation?.();
  map.touchPitch?.disable?.();
  map.dragRotate?.disable?.();

  let settleTimer = null;

  const beginManualGesture = event => {
    if (event?.touches && event.touches.length < 2) return;

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

  container.addEventListener('touchstart', beginManualGesture, {
    passive: true
  });
  container.addEventListener('touchmove', beginManualGesture, {
    passive: true
  });
  container.addEventListener('touchend', event => {
    if ((event?.touches?.length ?? 0) < 2) finishManualGesture();
  }, {
    passive: true
  });
  container.addEventListener('touchcancel', finishManualGesture, {
    passive: true
  });

  // MapLibre's gesture events are useful as a second signal on browsers where
  // touch lists are inconsistent, but never call map.stop() from here.
  map.on?.('zoomstart', event => {
    if (event?.originalEvent) {
      adapter.__atlasManualMapGesture = true;
      clearTimeout(settleTimer);
      settleTimer = null;
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
