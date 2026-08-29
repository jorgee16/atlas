const TURN_SOURCE = 'atlas-turn-highlight';
const TURN_CASING_LAYER = 'atlas-turn-highlight-casing';
const TURN_LAYER = 'atlas-turn-highlight-line';

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function lineFeature(points) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map(point => [point.lon, point.lat])
    }
  };
}

function collection(features) {
  return {
    type: 'FeatureCollection',
    features
  };
}

function distanceSquared(a, b) {
  const latScale = Math.cos((b.lat * Math.PI) / 180);
  const dLat = a.lat - b.lat;
  const dLon = (a.lon - b.lon) * latScale;
  return dLat * dLat + dLon * dLon;
}

function nearestRouteIndex(points, location) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const distance = distanceSquared(points[index], location);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function bearing(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function signedBearingDelta(fromBearing, toBearing) {
  return ((toBearing - fromBearing + 540) % 360) - 180;
}

function geometryDirection(delta) {
  if (delta <= -135 || delta >= 135) return 'uturn';
  if (delta < -25) return 'left';
  if (delta > 25) return 'right';
  return 'straight';
}

function maneuverDirection(maneuver, fallback) {
  const type = String(maneuver?.type ?? '').toLowerCase();
  const modifier = String(
    maneuver?.modifier ?? maneuver?.direction ?? ''
  ).toLowerCase();

  if (type.includes('roundabout') || type.includes('rotary')) {
    return 'roundabout';
  }
  if (modifier.includes('uturn') || modifier.includes('u-turn')) return 'uturn';
  if (modifier.includes('left') || type.includes('left')) return 'left';
  if (modifier.includes('right') || type.includes('right')) return 'right';
  if (modifier.includes('straight')) return 'straight';
  return fallback;
}

function activeManeuver(maneuvers, activeIndex) {
  return maneuvers
    .slice(Math.max(0, activeIndex))
    .find(item => item?.type !== 'depart' && validPoint(item?.location));
}

function maneuverSignature(maneuver, activeIndex) {
  if (!maneuver || !validPoint(maneuver.location)) return null;

  return [
    activeIndex,
    maneuver.type ?? '',
    maneuver.modifier ?? maneuver.direction ?? '',
    Number(maneuver.location.lat).toFixed(6),
    Number(maneuver.location.lon).toFixed(6),
    maneuver.instruction ?? maneuver.name ?? ''
  ].join(':');
}

function turnGeometry(route, maneuver) {
  const points = route?.points?.filter(validPoint) ?? [];
  if (points.length < 3 || !validPoint(maneuver?.location)) return null;

  const turnIndex = nearestRouteIndex(points, maneuver.location);

  // Keep the whole route blue. The orange overlay is deliberately limited to
  // the actual manoeuvre: one route vertex before the turn and one after it.
  // This avoids the previous long orange corridor that looked like a second
  // route rather than a turn cue.
  const startIndex = Math.max(0, turnIndex - 1);
  const endIndex = Math.min(points.length - 1, turnIndex + 1);
  const segment = points.slice(startIndex, endIndex + 1);

  if (segment.length < 2) return null;

  const incomingFromIndex = Math.max(0, turnIndex - 1);
  const incomingToIndex = Math.max(
    incomingFromIndex + 1,
    Math.min(turnIndex, points.length - 1)
  );
  const outgoingFromIndex = Math.min(turnIndex, points.length - 2);
  const outgoingToIndex = Math.min(points.length - 1, outgoingFromIndex + 1);

  const incomingBearing = bearing(
    points[incomingFromIndex],
    points[incomingToIndex]
  );
  const outgoingBearing = bearing(
    points[outgoingFromIndex],
    points[outgoingToIndex]
  );
  const delta = signedBearingDelta(incomingBearing, outgoingBearing);

  return {
    segment,
    direction: maneuverDirection(maneuver, geometryDirection(delta)),
    delta
  };
}

function arrowElement(direction) {
  const element = document.createElement('div');
  element.style.cssText = [
    'width:34px',
    'height:34px',
    'display:grid',
    'place-items:center',
    'filter:drop-shadow(0 2px 4px rgba(0,0,0,.34))',
    'pointer-events:none'
  ].join(';');

  const paths = {
    left: `
      <path d="M24 24v-4.5c0-5-4-9-9-9H7"></path>
      <path d="m12 5.5-5 5 5 5"></path>
    `,
    right: `
      <path d="M10 24v-4.5c0-5 4-9 9-9h8"></path>
      <path d="m22 5.5 5 5-5 5"></path>
    `,
    straight: `
      <path d="M17 27V7"></path>
      <path d="m10.5 13.5 6.5-6.5 6.5 6.5"></path>
    `,
    uturn: `
      <path d="M23 27V16a6 6 0 0 0-12 0v4"></path>
      <path d="m6 15 5 5 5-5"></path>
    `,
    roundabout: `
      <path d="M12 10.5a8 8 0 1 1-1.5 10.8"></path>
      <path d="m7.5 18 3 3.3 3.6-2.7"></path>
      <path d="M20 10.5h7"></path>
      <path d="m23 7.5 4 3-4 3"></path>
    `
  };

  element.innerHTML = `
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <g stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
        ${paths[direction] ?? paths.straight}
      </g>
      <g stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
        ${paths[direction] ?? paths.straight}
      </g>
    </svg>`;
  return element;
}

function removeTurnOverlay(adapter) {
  for (const marker of adapter.maneuverMarkers ?? []) {
    marker?.remove?.();
  }
  adapter.maneuverMarkers = [];

  try {
    for (const layerId of [TURN_LAYER, TURN_CASING_LAYER]) {
      if (adapter.map.getLayer?.(layerId)) {
        adapter.map.removeLayer(layerId);
      }
    }
    if (adapter.map.getSource?.(TURN_SOURCE)) {
      adapter.map.removeSource(TURN_SOURCE);
    }
  } catch {
    // A style swap can remove the overlay before Atlas gets here.
  }
}

function turnOverlayReady(adapter) {
  return Boolean(
    adapter.map.getSource?.(TURN_SOURCE) &&
    adapter.map.getLayer?.(TURN_LAYER) &&
    adapter.map.getLayer?.(TURN_CASING_LAYER) &&
    (adapter.maneuverMarkers?.length ?? 0) > 0
  );
}

export function installMapLibreTurnHighlight(AdapterClass) {
  if (!AdapterClass?.prototype || AdapterClass.prototype.__atlasTurnHighlightInstalled) {
    return;
  }

  Object.defineProperty(
    AdapterClass.prototype,
    '__atlasTurnHighlightInstalled',
    { value: true }
  );

  AdapterClass.prototype.showManeuvers = function showManeuvers(
    maneuvers,
    activeIndex = 0
  ) {
    this.currentManeuvers = Array.isArray(maneuvers) ? maneuvers : null;
    this.currentManeuverIndex = activeIndex;

    if (!Array.isArray(maneuvers)) {
      this.__atlasTurnSignature = null;
      this.__atlasTurnRoute = null;
      removeTurnOverlay(this);
      return;
    }

    const maneuver = activeManeuver(maneuvers, activeIndex);
    const signature = maneuverSignature(maneuver, activeIndex);

    if (
      signature &&
      signature === this.__atlasTurnSignature &&
      this.__atlasTurnRoute === this.currentRoute &&
      turnOverlayReady(this)
    ) {
      return;
    }

    removeTurnOverlay(this);

    const geometry = turnGeometry(this.currentRoute, maneuver);
    if (!maneuver || !geometry) {
      this.__atlasTurnSignature = null;
      this.__atlasTurnRoute = null;
      return;
    }

    try {
      this.map.addSource(TURN_SOURCE, {
        type: 'geojson',
        data: collection([lineFeature(geometry.segment)])
      });

      this.map.addLayer({
        id: TURN_CASING_LAYER,
        type: 'line',
        source: TURN_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 12,
          'line-opacity': 0.98
        }
      });

      this.map.addLayer({
        id: TURN_LAYER,
        type: 'line',
        source: TURN_SOURCE,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 7,
          'line-opacity': 1
        }
      });

      const marker = new this.maplibre.Marker({
        element: arrowElement(geometry.direction),
        anchor: 'center',
        rotationAlignment: 'viewport'
      })
        .setLngLat([maneuver.location.lon, maneuver.location.lat])
        .addTo(this.map);

      this.maneuverMarkers = [marker];
      this.__atlasTurnSignature = signature;
      this.__atlasTurnRoute = this.currentRoute;
      this.map.moveLayer?.(TURN_CASING_LAYER);
      this.map.moveLayer?.(TURN_LAYER);
    } catch (error) {
      this.__atlasTurnSignature = null;
      this.__atlasTurnRoute = null;
      console.warn('Unable to render MapLibre turn highlight.', error);
    }
  };

  AdapterClass.prototype.clearManeuvers = function clearManeuvers() {
    this.currentManeuvers = null;
    this.currentManeuverIndex = 0;
    this.__atlasTurnSignature = null;
    this.__atlasTurnRoute = null;
    removeTurnOverlay(this);
  };
}
