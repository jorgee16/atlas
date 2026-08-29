import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const GESTURE_SETTLE_MS = 160;
const TOUCH_ZOOM_RATE = 1.7;
const TOUCH_ZOOM_THRESHOLD = 0.008;

function configureTouchSurface(map) {
  const container = map?.getContainer?.();
  const canvas = map?.getCanvas?.();
  const canvasContainer = canvas?.parentElement ?? null;

  for (const element of [container, canvasContainer, canvas].filter(Boolean)) {
    element.style.touchAction = 'none';
    element.style.overscrollBehavior = 'contain';
    element.style.webkitUserSelect = 'none';
    element.style.userSelect = 'none';
    element.style.webkitTouchCallout = 'none';
  }
}

function configureTouchZoom(adapter) {
  const map = adapter?.map;
  if (!map) return;

  configureTouchSurface(map);
  map.touchZoomRotate?.enable?.();
  map.touchZoomRotate?.disableRotation?.();
  map.touchZoomRotate?.setZoomRate?.(TOUCH_ZOOM_RATE);
  map.touchZoomRotate?.setZoomThreshold?.(TOUCH_ZOOM_THRESHOLD);
  map.touchPitch?.disable?.();
  map.dragRotate?.disable?.();
}

function setGestureCompositingMode(active) {
  document.documentElement?.classList.toggle(
    'atlas-map-gesture-active',
    Boolean(active)
  );
}

function setSymbolLayersVisible(map, visible, previousVisibility = null) {
  const layers = map?.getStyle?.()?.layers ?? [];
  const restored = new Map();

  for (const layer of layers) {
    if (layer?.type !== 'symbol' || !layer?.id) continue;

    try {
      if (!visible) {
        const current = map.getLayoutProperty?.(layer.id, 'visibility') ?? 'visible';
        restored.set(layer.id, current);
        map.setLayoutProperty?.(layer.id, 'visibility', 'none');
      } else {
        const target = previousVisibility?.get(layer.id) ?? 'visible';
        map.setLayoutProperty?.(layer.id, 'visibility', target);
      }
    } catch {
      // A style swap can remove a layer between gesture start and end.
    }
  }

  return restored;
}

export function installMapLibreTouchZoom(adapter) {
  const map = adapter?.map;
  const container = map?.getContainer?.();
  if (!map || !container) return adapter;

  configureTouchZoom(adapter);

  if (adapter.__atlasTouchZoomInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasTouchZoomInstalled', { value: true });

  let settleTimer = null;
  let manualPinchActive = false;
  let hiddenSymbolLayers = null;

  const beginManualGesture = event => {
    if (event?.touches && event.touches.length < 2) return;

    // Active navigation calls setNavigationTravelMode(), which refreshes the
    // MapLibre touch handlers and is the one state where pinch remains smooth.
    // Refresh the same handler state at the start of every pinch so Explore and
    // Preview use the exact same touch configuration before MapLibre processes
    // the live two-finger gesture.
    configureTouchZoom(adapter);

    adapter.__atlasManualMapGesture = true;
    clearTimeout(settleTimer);
    settleTimer = null;

    if (!manualPinchActive) {
      manualPinchActive = true;
      setGestureCompositingMode(true);

      map.stop?.();

      hiddenSymbolLayers = setSymbolLayersVisible(map, false);
      map.triggerRepaint?.();
    }
  };

  const finishManualGesture = () => {
    if (hiddenSymbolLayers) {
      setSymbolLayersVisible(map, true, hiddenSymbolLayers);
      hiddenSymbolLayers = null;
      map.triggerRepaint?.();
    }

    manualPinchActive = false;
    setGestureCompositingMode(false);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      adapter.__atlasManualMapGesture = false;
      settleTimer = null;
    }, GESTURE_SETTLE_MS);
  };

  container.addEventListener('touchstart', beginManualGesture, {
    passive: true,
    capture: true
  });
  container.addEventListener('touchmove', beginManualGesture, {
    passive: true,
    capture: true
  });
  container.addEventListener('touchend', event => {
    if ((event?.touches?.length ?? 0) < 2) finishManualGesture();
  }, {
    passive: true,
    capture: true
  });
  container.addEventListener('touchcancel', finishManualGesture, {
    passive: true,
    capture: true
  });

  map.on?.('zoomstart', event => {
    if (event?.originalEvent) {
      adapter.__atlasManualMapGesture = true;
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  });
  map.on?.('zoomend', event => {
    if (event?.originalEvent && !manualPinchActive) finishManualGesture();
  });

  map.on?.('style.load', () => {
    configureTouchZoom(adapter);
    hiddenSymbolLayers = null;
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
    const result = await originalSetRegion.call(this, region, options);
    configureTouchZoom(this);
    return result;
  };

  const originalSetNavigationTravelMode = prototype.setNavigationTravelMode;
  prototype.setNavigationTravelMode = function setNavigationTravelMode(mode = null) {
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
