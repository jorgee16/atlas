const EARTH_RADIUS_METERS = 6378137;
const DRIVE_MAX_POSITION_PREDICTION_SECONDS = 1.2;
const WALK_MAX_POSITION_PREDICTION_SECONDS = 0.55;
const WALK_MIN_PREDICTION_SPEED_METERS_PER_SECOND = 0.45;
const DRIVE_MIN_PREDICTION_SPEED_METERS_PER_SECOND = 0.8;
const ACCURACY_SOURCE = 'atlas-user-accuracy';
const ACCURACY_FILL_LAYER = 'atlas-user-accuracy-fill';
const ACCURACY_LINE_LAYER = 'atlas-user-accuracy-line';

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function smoothingFactor(rate, deltaSeconds) {
  return 1 - Math.exp(-rate * deltaSeconds);
}

function gpsAccuracyConfidence(accuracy) {
  if (!Number.isFinite(accuracy)) return 0.35;
  return Math.max(0.12, Math.min(1, 30 / Math.max(accuracy, 10)));
}

function predictPosition(position, speed, heading, seconds) {
  if (
    !position ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    !Number.isFinite(heading) ||
    seconds <= 0
  ) {
    return position;
  }

  const distance = speed * seconds;
  const headingRadians = heading * Math.PI / 180;
  const latRadians = position.lat * Math.PI / 180;
  const north = Math.cos(headingRadians) * distance;
  const east = Math.sin(headingRadians) * distance;

  return {
    lat:
      position.lat +
      north / EARTH_RADIUS_METERS * 180 / Math.PI,
    lon:
      position.lon +
      east /
        (EARTH_RADIUS_METERS * Math.cos(latRadians)) *
        180 / Math.PI
  };
}

function accuracyFeature(latitude, longitude, radiusMeters) {
  const radius = Math.max(1, Number(radiusMeters) || 1);
  const latitudeRadians = latitude * Math.PI / 180;
  const coordinates = [];

  for (let index = 0; index <= 48; index += 1) {
    const angle = index / 48 * Math.PI * 2;
    const north = Math.cos(angle) * radius;
    const east = Math.sin(angle) * radius;
    coordinates.push([
      longitude +
        east /
          (EARTH_RADIUS_METERS * Math.cos(latitudeRadians)) *
          180 / Math.PI,
      latitude +
        north / EARTH_RADIUS_METERS * 180 / Math.PI
    ]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates]
    }
  };
}

function ensureAccuracyOverlay(adapter) {
  const map = adapter?.map;
  if (!map?.isStyleLoaded?.()) return false;

  try {
    if (!map.getSource(ACCURACY_SOURCE)) {
      map.addSource(ACCURACY_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });
    }

    if (!map.getLayer(ACCURACY_FILL_LAYER)) {
      map.addLayer({
        id: ACCURACY_FILL_LAYER,
        type: 'fill',
        source: ACCURACY_SOURCE,
        paint: {
          'fill-color': '#2563eb',
          'fill-opacity': 0.08
        }
      });
    }

    if (!map.getLayer(ACCURACY_LINE_LAYER)) {
      map.addLayer({
        id: ACCURACY_LINE_LAYER,
        type: 'line',
        source: ACCURACY_SOURCE,
        paint: {
          'line-color': '#2563eb',
          'line-width': 1.2,
          'line-opacity': 0.42
        }
      });
    }

    return true;
  } catch {
    return false;
  }
}

function updateAccuracyOverlay(adapter, renderedPosition, accuracy) {
  if (!renderedPosition || !Number.isFinite(accuracy)) return;
  if (!ensureAccuracyOverlay(adapter)) return;

  adapter.map
    .getSource(ACCURACY_SOURCE)
    ?.setData({
      type: 'FeatureCollection',
      features: [
        accuracyFeature(
          renderedPosition.lat,
          renderedPosition.lon,
          accuracy
        )
      ]
    });
}

function renderDrivingCursor(adapter, position) {
  if (
    adapter?.navigationTravelMode !== 'drive' ||
    !adapter.userMarkerElement
  ) {
    return;
  }

  const heading = adapter.navigationHeadingUp
    ? 0
    : Number.isFinite(adapter.navigationCameraHeading)
      ? normalizeBearing(adapter.navigationCameraHeading)
      : Number.isFinite(position?.heading)
        ? normalizeBearing(position.heading)
        : Number.isFinite(adapter.routeBearing)
          ? normalizeBearing(adapter.routeBearing)
          : 0;

  // MapLibrePmtilesMapAdapter still contains a legacy Leaflet-parity cursor
  // that wraps the drive arrow in a white circular badge. It runs after the
  // base MapLibre adapter, so always reassert the native MapLibre drive DOM
  // here. This also clears inline dimensions left by the legacy cursor.
  adapter.userMarkerElement.className = 'maplibre-user-marker drive';
  adapter.userMarkerElement.style.removeProperty('width');
  adapter.userMarkerElement.style.removeProperty('height');
  adapter.userMarkerElement.innerHTML = `
    <span class="maplibre-user-heading" style="transform:rotate(${heading}deg)">
      <span class="maplibre-user-arrow"></span>
    </span>
  `;
}

function renderWalkingHeading(adapter, position) {
  if (
    adapter?.navigationTravelMode !== 'walk' ||
    !adapter.userMarkerElement
  ) {
    return;
  }

  const heading = Number.isFinite(position?.heading)
    ? normalizeBearing(position.heading)
    : Number.isFinite(adapter.routeBearing)
      ? normalizeBearing(adapter.routeBearing)
      : null;

  if (!Number.isFinite(heading)) return;

  const mapBearing = Number.isFinite(adapter.map?.getBearing?.())
    ? adapter.map.getBearing()
    : 0;
  const screenHeading = normalizeBearing(heading - mapBearing);

  adapter.userMarkerElement.className = '';
  adapter.userMarkerElement.style.width = '42px';
  adapter.userMarkerElement.style.height = '42px';
  adapter.userMarkerElement.innerHTML = `
    <div style="position:relative;width:42px;height:42px;transform:rotate(${screenHeading}deg);transition:transform 220ms ease;">
      <div style="position:absolute;top:0;left:50%;width:0;height:0;transform:translateX(-50%);border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:22px solid #2563eb;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28));"></div>
      <div style="position:absolute;left:50%;bottom:5px;width:18px;height:18px;transform:translateX(-50%);background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.28);"></div>
    </div>`;
}

export function installMapLibreGpsParity(adapter) {
  if (!adapter || adapter.__atlasGpsParityInstalled) return adapter;

  Object.defineProperty(adapter, '__atlasGpsParityInstalled', {
    value: true
  });

  const originalUpdateUserLocation =
    adapter.updateUserLocation.bind(adapter);
  const originalFollowPosition =
    adapter.followPosition.bind(adapter);
  const originalSetNavigationTravelMode =
    adapter.setNavigationTravelMode.bind(adapter);

  const state = {
    rendered: null,
    target: null,
    latestSpeed: null,
    latestHeading: null,
    latestAccuracy: null,
    latestFixTimestamp: null,
    animationFrame: null,
    animationTimestamp: null,
    lastPosition: null
  };

  const animate = timestamp => {
    state.animationFrame = null;

    if (!state.rendered || !state.target || !adapter.userMarker) {
      state.animationTimestamp = null;
      return;
    }

    if (state.animationTimestamp === null) {
      state.animationTimestamp = timestamp;
    }

    const deltaSeconds = Math.min(
      Math.max((timestamp - state.animationTimestamp) / 1000, 0),
      0.1
    );
    state.animationTimestamp = timestamp;

    const mode = adapter.navigationTravelMode;
    const maxPredictionSeconds = mode === 'drive'
      ? DRIVE_MAX_POSITION_PREDICTION_SECONDS
      : mode === 'walk'
        ? WALK_MAX_POSITION_PREDICTION_SECONDS
        : 0;
    const minimumPredictionSpeed = mode === 'drive'
      ? DRIVE_MIN_PREDICTION_SPEED_METERS_PER_SECOND
      : WALK_MIN_PREDICTION_SPEED_METERS_PER_SECOND;

    const predictionHeading =
      mode === 'drive' && Number.isFinite(adapter.navigationCameraHeading)
        ? adapter.navigationCameraHeading
        : state.latestHeading;

    const predictionEnabled =
      maxPredictionSeconds > 0 &&
      Number.isFinite(state.latestSpeed) &&
      state.latestSpeed >= minimumPredictionSpeed &&
      Number.isFinite(predictionHeading);

    const predictionSeconds =
      predictionEnabled && state.latestFixTimestamp !== null
        ? Math.min(
            maxPredictionSeconds,
            Math.max(
              0,
              (performance.now() - state.latestFixTimestamp) / 1000
            )
          )
        : 0;

    const predictedTarget = predictionEnabled
      ? predictPosition(
          state.target,
          state.latestSpeed,
          predictionHeading,
          predictionSeconds
        )
      : state.target;

    const baseSmoothingRate = mode === 'drive' ? 2.8 : 3.2;
    const amount = smoothingFactor(
      baseSmoothingRate * gpsAccuracyConfidence(state.latestAccuracy),
      deltaSeconds
    );

    state.rendered.lat +=
      (predictedTarget.lat - state.rendered.lat) * amount;
    state.rendered.lon +=
      (predictedTarget.lon - state.rendered.lon) * amount;

    adapter.userMarker.setLngLat([
      state.rendered.lon,
      state.rendered.lat
    ]);
    updateAccuracyOverlay(adapter, state.rendered, state.latestAccuracy);
    renderDrivingCursor(adapter, state.lastPosition);
    renderWalkingHeading(adapter, state.lastPosition);

    const latDifference = Math.abs(predictedTarget.lat - state.rendered.lat);
    const lonDifference = Math.abs(predictedTarget.lon - state.rendered.lon);
    const stillPredicting =
      predictionEnabled && predictionSeconds < maxPredictionSeconds;

    if (
      stillPredicting ||
      latDifference >= 0.0000001 ||
      lonDifference >= 0.0000001
    ) {
      state.animationFrame = requestAnimationFrame(animate);
    } else {
      state.animationTimestamp = null;
    }
  };

  adapter.updateUserLocation = function updateUserLocation(
    position,
    firstFix = false
  ) {
    const latitude = position?.latitude;
    const longitude = position?.longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return originalUpdateUserLocation(position, firstFix);
    }

    const previousRendered = state.rendered
      ? { ...state.rendered }
      : null;

    originalUpdateUserLocation(position, firstFix);

    state.target = { lat: latitude, lon: longitude };
    state.latestSpeed = Number.isFinite(position?.speed)
      ? position.speed
      : null;
    state.latestHeading = Number.isFinite(position?.heading)
      ? normalizeBearing(position.heading)
      : null;
    state.latestAccuracy = Number.isFinite(position?.accuracy)
      ? position.accuracy
      : null;
    state.latestFixTimestamp = performance.now();
    state.lastPosition = { ...position };

    if (firstFix || !previousRendered) {
      state.rendered = { ...state.target };
    } else {
      state.rendered = previousRendered;
      adapter.userMarker?.setLngLat([
        state.rendered.lon,
        state.rendered.lat
      ]);
    }

    updateAccuracyOverlay(adapter, state.rendered, state.latestAccuracy);
    renderDrivingCursor(adapter, position);
    renderWalkingHeading(adapter, position);

    if (state.animationFrame === null) {
      state.animationTimestamp = null;
      state.animationFrame = requestAnimationFrame(animate);
    }
  };

  adapter.followPosition = function followPosition(position, options = {}) {
    const rendered = state.rendered;
    const smoothedPosition = rendered
      ? {
          ...position,
          latitude: rendered.lat,
          longitude: rendered.lon,
          lat: rendered.lat,
          lon: rendered.lon
        }
      : position;

    const result = originalFollowPosition(smoothedPosition, options);
    renderDrivingCursor(adapter, state.lastPosition ?? position);
    renderWalkingHeading(adapter, state.lastPosition ?? position);
    return result;
  };

  adapter.setNavigationTravelMode = function setNavigationTravelMode(mode = null) {
    const result = originalSetNavigationTravelMode(mode);
    renderDrivingCursor(adapter, state.lastPosition);
    renderWalkingHeading(adapter, state.lastPosition);
    return result;
  };

  adapter.map?.on?.('style.load', () => {
    updateAccuracyOverlay(adapter, state.rendered, state.latestAccuracy);
  });

  return adapter;
}
