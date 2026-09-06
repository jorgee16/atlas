const DRIVE_MAX_POSITION_PREDICTION_SECONDS = 1.2;
const WALK_MAX_POSITION_PREDICTION_SECONDS = 0.55;
const DRIVE_MIN_PREDICTION_SPEED_METERS_PER_SECOND = 0.8;
const WALK_MIN_PREDICTION_SPEED_METERS_PER_SECOND = 0.45;
const EARTH_RADIUS_METERS = 6371000;
const RATE_SAMPLE_LIMIT = 8;

function finite(value) {
  return Number.isFinite(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function updateRate(samples, timestamp) {
  if (!finite(timestamp)) return 0;

  samples.push(timestamp);
  if (samples.length > RATE_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - RATE_SAMPLE_LIMIT);
  }

  if (samples.length < 2) return 0;

  const elapsed = samples[samples.length - 1] - samples[0];
  if (elapsed <= 0) return 0;

  return (samples.length - 1) * 1000 / elapsed;
}

function distanceMeters(a, b) {
  if (
    !finite(a?.lat) ||
    !finite(a?.lon) ||
    !finite(b?.lat) ||
    !finite(b?.lon)
  ) {
    return null;
  }

  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function predictionSeconds(adapter, state, now) {
  const mode = adapter.navigationTravelMode;
  const speed = state.latestPosition?.speed;
  const heading = finite(adapter.navigationCameraHeading)
    ? adapter.navigationCameraHeading
    : state.latestPosition?.heading;

  const maximum = mode === 'drive'
    ? DRIVE_MAX_POSITION_PREDICTION_SECONDS
    : mode === 'walk'
      ? WALK_MAX_POSITION_PREDICTION_SECONDS
      : 0;

  const minimumSpeed = mode === 'drive'
    ? DRIVE_MIN_PREDICTION_SPEED_METERS_PER_SECOND
    : WALK_MIN_PREDICTION_SPEED_METERS_PER_SECOND;

  if (
    maximum <= 0 ||
    !finite(speed) ||
    speed < minimumSpeed ||
    !finite(heading) ||
    state.latestFixTimestamp === null
  ) {
    return 0;
  }

  return clamp(
    (now - state.latestFixTimestamp) / 1000,
    0,
    maximum
  );
}

function markerPosition(adapter) {
  const value = adapter.userMarker?.getLngLat?.();
  if (!value) return null;
  return {
    lat: value.lat,
    lon: value.lng
  };
}

function render(adapter, state, now = performance.now()) {
  const element = adapter.gpsDiagnosticsElement;
  if (!element) return;

  const position = state.latestPosition;
  const target = position && finite(position.latitude) && finite(position.longitude)
    ? {
        lat: position.latitude,
        lon: position.longitude
      }
    : null;
  const rendered = markerPosition(adapter);
  const smoothingDistance = distanceMeters(target, rendered);
  const prediction = predictionSeconds(adapter, state, now);
  const speedKmh = finite(position?.speed)
    ? position.speed * 3.6
    : null;
  const heading = finite(position?.heading)
    ? ((position.heading % 360) + 360) % 360
    : null;
  const zoom = adapter.map?.getZoom?.();
  const pitch = adapter.map?.getPitch?.();
  const bearing = adapter.map?.getBearing?.();
  const rawDelta = finite(state.rawProviderDeltaMs)
    ? `${Math.round(state.rawProviderDeltaMs)} ms`
    : '—';

  element.innerHTML = `
    <strong>GPS diagnostics</strong>
    <span>Renderer MapLibre</span>
    <span>FPS ${state.fps.toFixed(0)}</span>
    <span>GPS ${state.rawGpsHz.toFixed(2)} Hz · ${rawDelta} · ${state.rawSource}</span>
    <span>Cursor ${state.cursorWriteHz.toFixed(2)} Hz</span>
    <span>Acc ${finite(position?.accuracy) ? `${position.accuracy.toFixed(1)} m` : '—'}</span>
    <span>Speed ${speedKmh === null ? '—' : `${speedKmh.toFixed(1)} km/h`}</span>
    <span>Head ${heading === null ? '—' : `${Math.round(heading)}°`}</span>
    <span>Pred ${prediction.toFixed(2)} s</span>
    <span>Smooth ${smoothingDistance === null ? '—' : `${smoothingDistance.toFixed(1)} m`}</span>
    <span>Cam ${finite(zoom) ? `z${zoom.toFixed(1)}` : 'z—'} · ${finite(pitch) ? `p${Math.round(pitch)}°` : 'p—'} · ${finite(bearing) ? `b${Math.round(bearing)}°` : 'b—'}</span>
  `;
}

export function installMapLibreGpsDiagnostics(adapter) {
  if (!adapter || adapter.__atlasMapLibreGpsDiagnosticsInstalled) {
    return adapter;
  }

  Object.defineProperty(
    adapter,
    '__atlasMapLibreGpsDiagnosticsInstalled',
    { value: true }
  );

  const originalUpdateUserLocation =
    adapter.updateUserLocation.bind(adapter);
  const originalSetVisible =
    adapter.setGpsDiagnosticsVisible.bind(adapter);

  const state = {
    latestPosition: null,
    latestFixTimestamp: null,
    cursorWriteSamples: [],
    cursorWriteHz: 0,
    rawSamples: [],
    rawGpsHz: 0,
    rawSource: '—',
    rawProviderTimestamp: null,
    rawCallbackTimestamp: null,
    rawProviderDeltaMs: null,
    rawCallbackDeltaMs: null,
    frameWindowStart: null,
    frameCount: 0,
    fps: 0,
    animationFrame: null
  };

  const onRawGpsFix = event => {
    const detail = event?.detail ?? {};
    const providerTimestamp = detail.providerTimestamp;
    const callbackTimestamp = detail.callbackReceivedAt;

    if (finite(providerTimestamp) && finite(state.rawProviderTimestamp)) {
      const delta = providerTimestamp - state.rawProviderTimestamp;
      state.rawProviderDeltaMs = delta > 0 ? delta : null;
    }

    if (finite(callbackTimestamp) && finite(state.rawCallbackTimestamp)) {
      const delta = callbackTimestamp - state.rawCallbackTimestamp;
      state.rawCallbackDeltaMs = delta > 0 ? delta : null;
    }

    if (finite(providerTimestamp)) {
      state.rawProviderTimestamp = providerTimestamp;
      state.rawGpsHz = updateRate(state.rawSamples, providerTimestamp);
    }
    if (finite(callbackTimestamp)) {
      state.rawCallbackTimestamp = callbackTimestamp;
    }

    state.rawSource = detail.source ?? 'unknown';

    if (adapter.gpsDiagnosticsVisible) {
      render(adapter, state);
    }
  };

  globalThis.addEventListener?.('atlasrawgpsfix', onRawGpsFix);

  const frame = timestamp => {
    state.animationFrame = null;

    if (!adapter.gpsDiagnosticsVisible) {
      state.frameWindowStart = null;
      state.frameCount = 0;
      return;
    }

    if (state.frameWindowStart === null) {
      state.frameWindowStart = timestamp;
    }

    state.frameCount += 1;
    const elapsed = timestamp - state.frameWindowStart;

    if (elapsed >= 500) {
      state.fps = state.frameCount * 1000 / elapsed;
      state.frameCount = 0;
      state.frameWindowStart = timestamp;
      render(adapter, state, timestamp);
    }

    state.animationFrame = requestAnimationFrame(frame);
  };

  const ensureFrameLoop = () => {
    if (
      adapter.gpsDiagnosticsVisible &&
      state.animationFrame === null
    ) {
      state.animationFrame = requestAnimationFrame(frame);
    }
  };

  adapter.updateUserLocation = function updateUserLocation(
    position,
    firstFix = false
  ) {
    const now = performance.now();
    state.latestPosition = position ? { ...position } : null;
    state.latestFixTimestamp = now;
    state.cursorWriteHz = updateRate(state.cursorWriteSamples, now);

    const result = originalUpdateUserLocation(position, firstFix);

    if (adapter.gpsDiagnosticsVisible) {
      render(adapter, state, now);
      ensureFrameLoop();
    }

    return result;
  };

  adapter.setGpsDiagnosticsVisible = function setGpsDiagnosticsVisible(visible) {
    const result = originalSetVisible(visible);

    if (result) {
      render(adapter, state);
      ensureFrameLoop();
    } else if (state.animationFrame !== null) {
      cancelAnimationFrame(state.animationFrame);
      state.animationFrame = null;
      state.frameWindowStart = null;
      state.frameCount = 0;
    }

    return result;
  };

  adapter.resetGpsDiagnostics = function resetGpsDiagnostics() {
    state.cursorWriteSamples.length = 0;
    state.cursorWriteHz = 0;
    state.rawSamples.length = 0;
    state.rawGpsHz = 0;
    state.rawProviderTimestamp = null;
    state.rawCallbackTimestamp = null;
    state.rawProviderDeltaMs = null;
    state.rawCallbackDeltaMs = null;
    state.frameWindowStart = null;
    state.frameCount = 0;
    state.fps = 0;
    render(adapter, state);
  };

  render(adapter, state);
  return adapter;
}