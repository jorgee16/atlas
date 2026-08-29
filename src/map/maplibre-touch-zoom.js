import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const GESTURE_SETTLE_MS = 160;
const NAVIGATION_TOUCH_ZOOM_RATE = 1.7;
const BROWSE_TOUCH_ZOOM_RATE = 2.15;
const NAVIGATION_TOUCH_ZOOM_THRESHOLD = 0.008;
const BROWSE_TOUCH_ZOOM_THRESHOLD = 0.004;
const BROWSE_SYMBOL_RESTORE_MS = 90;

function configureTouchZoom(adapter) {
  const map = adapter?.map;
  if (!map) return;

  const navigationActive = Boolean(adapter.navigationTravelMode);

  map.touchZoomRotate?.enable?.();
  map.touchZoomRotate?.disableRotation?.();
  map.touchZoomRotate?.setZoomRate?.(
    navigationActive
      ? NAVIGATION_TOUCH_ZOOM_RATE
      : BROWSE_TOUCH_ZOOM_RATE
  );
  map.touchZoomRotate?.setZoomThreshold?.(
    navigationActive
      ? NAVIGATION_TOUCH_ZOOM_THRESHOLD
      : BROWSE_TOUCH_ZOOM_THRESHOLD
  );
  map.touchPitch?.disable?.();
  map.dragRotate?.disable?.();
}

function suspendBrowseSymbols(adapter) {
  if (adapter.navigationTravelMode || adapter.__atlasBrowseSymbolsSuspended) return;

  const map = adapter.map;
  const layers = map?.getStyle?.()?.layers ?? [];
  const previous = [];

  for (const layer of layers) {
    if (layer?.type !== 'symbol' || !layer?.id) continue;

    let visibility = 'visible';
    try {
      visibility = map.getLayoutProperty?.(layer.id, 'visibility') ?? 'visible';
      if (visibility === 'none') continue;
      map.setLayoutProperty?.(layer.id, 'visibility', 'none');
      previous.push([layer.id, visibility]);
    } catch {
      // Style can swap while a gesture is starting; skip unavailable layers.
    }
  }

  adapter.__atlasBrowseSymbolsSuspended = previous;
}

function restoreBrowseSymbols(adapter) {
  const previous = adapter.__atlasBrowseSymbolsSuspended;
  if (!Array.isArray(previous)) return;

  adapter.__atlasBrowseSymbolsSuspended = null;
  const map = adapter.map;

  for (const [layerId, visibility] of previous) {
    try {
      if (map.getLayer?.(layerId)) {
        map.setLayoutProperty?.(layerId, 'visibility', visibility ?? 'visible');
      }
    } catch {
      // Ignore layers removed during a style swap.
    }
  }
}

export function installMapLibreTouchZoom(adapter) {
  const map = adapter?.map;
  const container = map?.getContainer?.();
  if (!map || !container) return adapter;

  configureTouchZoom(adapter);

  if (adapter.__atlasTouchZoomInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasTouchZoomInstalled', { value: true });

  let settleTimer = null;
  let symbolRestoreTimer = null;

  const beginManualGesture = event => {
    if (event?.touches && event.touches.length < 2) return;

    adapter.__atlasManualMapGesture = true;
    clearTimeout(settleTimer);
    settleTimer = null;

    if (!adapter.navigationTravelMode) {
      clearTimeout(symbolRestoreTimer);
      symbolRestoreTimer = null;
      suspendBrowseSymbols(adapter);
    }
  };

  const finishManualGesture = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      adapter.__atlasManualMapGesture = false;
      settleTimer = null;
    }, GESTURE_SETTLE_MS);

    clearTimeout(symbolRestoreTimer);
    symbolRestoreTimer = setTimeout(() => {
      restoreBrowseSymbols(adapter);
      symbolRestoreTimer = null;
    }, BROWSE_SYMBOL_RESTORE_MS);
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

  map.on?.('zoomstart', event => {
    if (event?.originalEvent) {
      adapter.__atlasManualMapGesture = true;
      clearTimeout(settleTimer);
      settleTimer = null;
      if (!adapter.navigationTravelMode) suspendBrowseSymbols(adapter);
    }
  });
  map.on?.('zoomend', event => {
    if (event?.originalEvent) finishManualGesture();
  });

  map.on?.('style.load', () => {
    adapter.__atlasBrowseSymbolsSuspended = null;
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
    restoreBrowseSymbols(this);
    const result = originalSetNavigationTravelMode.call(this, mode);
    configureTouchZoom(this);
    return result;
  };

  const originalOnMoveEnd = prototype.onMoveEnd;
  if (typeof originalOnMoveEnd === 'function') {
    prototype.onMoveEnd = function onMoveEnd(callback) {
      installMapLibreTouchZoom(this);
      return originalOnMoveEnd.call(this, callback);
    };
  }
}
