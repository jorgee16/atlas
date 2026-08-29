import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const GESTURE_SETTLE_MS = 120;
const PINCH_ZOOM_SCALE = 1.35;
const PINCH_EASE = 0.42;
const PINCH_EPSILON = 0.002;
const PAN_EASE = 0.58;
const PAN_EPSILON_PX = 0.12;
const PAN_START_THRESHOLD_PX = 4;

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

function configureTouchGestures(adapter) {
  const map = adapter?.map;
  if (!map) return;

  configureTouchSurface(map);

  // Android WebView can deliver MapLibre's native touch-camera updates in
  // visible steps. Atlas owns pan and pinch and feeds camera changes on
  // requestAnimationFrame instead.
  map.dragPan?.disable?.();
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

function touchPoint(touch) {
  return touch
    ? { x: touch.clientX, y: touch.clientY }
    : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function installMapLibreTouchZoom(adapter) {
  const map = adapter?.map;
  const container = map?.getContainer?.();
  if (!map || !container) return adapter;

  configureTouchGestures(adapter);

  if (adapter.__atlasTouchZoomInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasTouchZoomInstalled', { value: true });

  let settleTimer = null;
  let frame = null;

  let pinchActive = false;
  let startDistance = null;
  let startZoom = null;
  let targetZoom = null;
  let renderedZoom = null;

  let panTracking = false;
  let panActive = false;
  let panStartPoint = null;
  let panLastPoint = null;
  let panTargetX = 0;
  let panTargetY = 0;
  let panRenderedX = 0;
  let panRenderedY = 0;

  const markManualGesture = () => {
    adapter.__atlasManualMapGesture = true;
    clearTimeout(settleTimer);
    settleTimer = null;
  };

  const settleManualGesture = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      adapter.__atlasManualMapGesture = false;
      settleTimer = null;
    }, GESTURE_SETTLE_MS);
  };

  const resetPan = () => {
    panTracking = false;
    panActive = false;
    panStartPoint = null;
    panLastPoint = null;
    panTargetX = 0;
    panTargetY = 0;
    panRenderedX = 0;
    panRenderedY = 0;
  };

  const renderFrame = () => {
    frame = null;
    let needsAnotherFrame = false;

    if (pinchActive && Number.isFinite(targetZoom)) {
      const current = Number.isFinite(renderedZoom)
        ? renderedZoom
        : map.getZoom();
      const delta = targetZoom - current;
      const nextZoom = Math.abs(delta) <= PINCH_EPSILON
        ? targetZoom
        : current + delta * PINCH_EASE;

      renderedZoom = nextZoom;
      map.jumpTo({ zoom: nextZoom });
      needsAnotherFrame =
        pinchActive || Math.abs(targetZoom - nextZoom) > PINCH_EPSILON;
    } else if (panActive) {
      const remainingX = panTargetX - panRenderedX;
      const remainingY = panTargetY - panRenderedY;
      const stepX = Math.abs(remainingX) <= PAN_EPSILON_PX
        ? remainingX
        : remainingX * PAN_EASE;
      const stepY = Math.abs(remainingY) <= PAN_EPSILON_PX
        ? remainingY
        : remainingY * PAN_EASE;

      if (stepX !== 0 || stepY !== 0) {
        const center = map.getCenter?.();
        const projected = center ? map.project?.(center) : null;

        if (projected && map.unproject) {
          const nextCenter = map.unproject([
            projected.x - stepX,
            projected.y - stepY
          ]);
          map.jumpTo({ center: nextCenter });
        }

        panRenderedX += stepX;
        panRenderedY += stepY;
      }

      needsAnotherFrame =
        panActive &&
        (
          Math.abs(panTargetX - panRenderedX) > PAN_EPSILON_PX ||
          Math.abs(panTargetY - panRenderedY) > PAN_EPSILON_PX
        );
    }

    if (needsAnotherFrame) {
      frame = requestAnimationFrame(renderFrame);
    }
  };

  const ensureFrame = () => {
    if (frame === null) {
      frame = requestAnimationFrame(renderFrame);
    }
  };

  const stopFrame = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const beginPinch = event => {
    if ((event?.touches?.length ?? 0) < 2) return;

    const distance = touchDistance(event.touches);
    if (!Number.isFinite(distance) || distance <= 0) return;

    event.preventDefault?.();
    markManualGesture();

    if (!pinchActive) {
      resetPan();
      pinchActive = true;
      startDistance = distance;
      startZoom = map.getZoom();
      targetZoom = startZoom;
      renderedZoom = startZoom;
      map.stop?.();
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
      map.jumpTo({ zoom: targetZoom });
    }

    targetZoom = null;
    renderedZoom = null;
    stopFrame();
    settleManualGesture();
  };

  const beginPanTracking = event => {
    if ((event?.touches?.length ?? 0) !== 1 || pinchActive) return;

    const point = touchPoint(event.touches[0]);
    if (!point) return;

    panTracking = true;
    panActive = false;
    panStartPoint = point;
    panLastPoint = point;
    panTargetX = 0;
    panTargetY = 0;
    panRenderedX = 0;
    panRenderedY = 0;
  };

  const updatePan = event => {
    if ((event?.touches?.length ?? 0) !== 1 || pinchActive) return;

    if (!panTracking) beginPanTracking(event);
    if (!panTracking || !panLastPoint || !panStartPoint) return;

    const point = touchPoint(event.touches[0]);
    if (!point) return;

    const totalDx = point.x - panStartPoint.x;
    const totalDy = point.y - panStartPoint.y;

    if (
      !panActive &&
      Math.hypot(totalDx, totalDy) >= PAN_START_THRESHOLD_PX
    ) {
      panActive = true;
      markManualGesture();
      map.stop?.();
    }

    if (!panActive) {
      panLastPoint = point;
      return;
    }

    event.preventDefault?.();

    panTargetX += point.x - panLastPoint.x;
    panTargetY += point.y - panLastPoint.y;
    panLastPoint = point;
    ensureFrame();
  };

  const finishPan = () => {
    if (!panTracking) return;

    const wasActive = panActive;

    if (wasActive) {
      const remainingX = panTargetX - panRenderedX;
      const remainingY = panTargetY - panRenderedY;

      if (remainingX !== 0 || remainingY !== 0) {
        const center = map.getCenter?.();
        const projected = center ? map.project?.(center) : null;
        if (projected && map.unproject) {
          map.jumpTo({
            center: map.unproject([
              projected.x - remainingX,
              projected.y - remainingY
            ])
          });
        }
      }
    }

    resetPan();
    stopFrame();

    if (wasActive) {
      settleManualGesture();
    }
  };

  container.addEventListener('touchstart', event => {
    if ((event?.touches?.length ?? 0) >= 2) {
      beginPinch(event);
      return;
    }

    beginPanTracking(event);
  }, {
    passive: false,
    capture: true
  });

  container.addEventListener('touchmove', event => {
    if ((event?.touches?.length ?? 0) >= 2) {
      updatePinch(event);
      return;
    }

    updatePan(event);
  }, {
    passive: false,
    capture: true
  });

  container.addEventListener('touchend', event => {
    const touchCount = event?.touches?.length ?? 0;

    if (pinchActive && touchCount < 2) {
      finishPinch();
      if (touchCount === 1) beginPanTracking(event);
      return;
    }

    if (touchCount === 0) finishPan();
  }, {
    passive: true,
    capture: true
  });

  container.addEventListener('touchcancel', () => {
    finishPinch();
    finishPan();
  }, {
    passive: true,
    capture: true
  });

  map.on?.('style.load', () => {
    configureTouchGestures(adapter);
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
    configureTouchGestures(this);
    return result;
  };

  const originalSetNavigationTravelMode = prototype.setNavigationTravelMode;
  prototype.setNavigationTravelMode = function setNavigationTravelMode(mode = null) {
    const result = originalSetNavigationTravelMode.call(this, mode);
    configureTouchGestures(this);
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
