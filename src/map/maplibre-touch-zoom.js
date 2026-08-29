import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const GESTURE_SETTLE_MS = 120;
const PINCH_ZOOM_SCALE = 1.35;
const PINCH_EASE = 0.42;
const PINCH_EPSILON = 0.002;

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

  // Android WebView was delivering MapLibre's native pinch camera updates in
  // visible steps outside active navigation. Keep normal one-finger panning,
  // but own two-finger zoom ourselves and feed the camera once per animation
  // frame instead of once per browser touch event.
  map.touchZoomRotate?.disable?.();
  map.touchPitch?.disable?.();
  map.dragRotate?.disable?.();
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return null;
  const dx = touches[1].clientX - touches[0].clientX;
  const dy = touches[1].clientY - touches[0].clientY;
  return Math.hypot(dx, dy);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function setGestureCompositingMode(active) {
  document.documentElement?.classList.toggle(
    'atlas-map-gesture-active',
    Boolean(active)
  );
}

export function installMapLibreTouchZoom(adapter) {
  const map = adapter?.map;
  const container = map?.getContainer?.();
  if (!map || !container) return adapter;

  configureTouchZoom(adapter);

  if (adapter.__atlasTouchZoomInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasTouchZoomInstalled', { value: true });

  let settleTimer = null;
  let pinchActive = false;
  let startDistance = null;
  let startZoom = null;
  let targetZoom = null;
  let renderedZoom = null;
  let frame = null;
  let dragPanWasEnabled = true;

  const stopFrame = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const renderPinchFrame = () => {
    frame = null;

    if (!pinchActive || !Number.isFinite(targetZoom)) return;

    const current = Number.isFinite(renderedZoom)
      ? renderedZoom
      : map.getZoom();
    const delta = targetZoom - current;
    const nextZoom = Math.abs(delta) <= PINCH_EPSILON
      ? targetZoom
      : current + delta * PINCH_EASE;

    renderedZoom = nextZoom;
    map.jumpTo({ zoom: nextZoom });

    if (pinchActive || Math.abs(targetZoom - nextZoom) > PINCH_EPSILON) {
      frame = requestAnimationFrame(renderPinchFrame);
    }
  };

  const ensureFrame = () => {
    if (frame === null) {
      frame = requestAnimationFrame(renderPinchFrame);
    }
  };

  const beginPinch = event => {
    if ((event?.touches?.length ?? 0) < 2) return;

    const distance = touchDistance(event.touches);
    if (!Number.isFinite(distance) || distance <= 0) return;

    event.preventDefault?.();
    adapter.__atlasManualMapGesture = true;
    clearTimeout(settleTimer);
    settleTimer = null;

    if (!pinchActive) {
      pinchActive = true;
      startDistance = distance;
      startZoom = map.getZoom();
      targetZoom = startZoom;
      renderedZoom = startZoom;
      dragPanWasEnabled = map.dragPan?.isEnabled?.() ?? true;
      map.dragPan?.disable?.();
      map.stop?.();
      setGestureCompositingMode(true);
      ensureFrame();
    }
  };

  const updatePinch = event => {
    if ((event?.touches?.length ?? 0) < 2) return;

    if (!pinchActive) beginPinch(event);
    if (!pinchActive) return;

    const distance = touchDistance(event.touches);
    if (!Number.isFinite(distance) || distance <= 0 || !startDistance) return;

    event.preventDefault?.();

    const zoomDelta = Math.log2(distance / startDistance) * PINCH_ZOOM_SCALE;
    const minimum = map.getMinZoom?.() ?? 0;
    const maximum = map.getMaxZoom?.() ?? 24;
    targetZoom = clamp(startZoom + zoomDelta, minimum, maximum);
    ensureFrame();
  };

  const finishPinch = () => {
    if (!pinchActive) return;

    pinchActive = false;
    startDistance = null;
    startZoom = null;

    if (Number.isFinite(targetZoom)) {
      renderedZoom = targetZoom;
      map.jumpTo({ zoom: targetZoom });
    }

    targetZoom = null;
    renderedZoom = null;
    stopFrame();

    if (dragPanWasEnabled) {
      map.dragPan?.enable?.();
    }

    setGestureCompositingMode(false);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      adapter.__atlasManualMapGesture = false;
      settleTimer = null;
    }, GESTURE_SETTLE_MS);
  };

  container.addEventListener('touchstart', beginPinch, {
    passive: false,
    capture: true
  });
  container.addEventListener('touchmove', updatePinch, {
    passive: false,
    capture: true
  });
  container.addEventListener('touchend', event => {
    if ((event?.touches?.length ?? 0) < 2) finishPinch();
  }, {
    passive: true,
    capture: true
  });
  container.addEventListener('touchcancel', finishPinch, {
    passive: true,
    capture: true
  });

  map.on?.('style.load', () => {
    configureTouchZoom(adapter);
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
