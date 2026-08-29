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

function turnDirection(delta) {
  if (delta <= -135 || delta >= 135) return 'uturn';
  if (delta < -25) return 'left';
  if (delta > 25) return 'right';
  return 'straight';
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
    Number(maneuver.location.lat).toFixed(6),
    Number(maneuver.location.lon).toFixed(6),
    maneuver.instruction ?? maneuver.name ?? ''
  ].join(':');
}

function turnGeometry(route, maneuver) {
  const points = route?.points?.filter(validPoint) ?? [];
  if (points.length < 3 || !validPoint(maneuver?.location)) return null;

  const turnIndex = nearestRouteIndex(points, maneuver.location);
  const startIndex = Math.max(0, turnIndex - 2);
  const endIndex = Math.min(points.length - 1, turnIndex + 3);
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
    direction: turnDirection(delta),
    delta
  };
}

function arrowElement(direction) {
  const element = document.createElement('div');
  element.style.cssText = [
    'width:30px',
    'height:30px',
    'display:grid',
    'place-items:center',
    'filter:drop-shadow(0 2px 3px rgba(0,0,0,.30))',
    'pointer-events:none'
  ].join(';');

  const paths = {
    left: 'M20 5v5h-7.2c-3.7 0-6.8 3-6.8 6.8V20h4v-3.2c0-1.5 1.3-2.8 2.8-2.8H20v5l7-7-7-7Z',
    right: 'M10 5v5h7.2c3.7 0 6.8 3 6.8 6.8V20h-4v-3.2c0-1.5-1.3-2.8-2.8-2.8H10v5l-7-7 7-7Z',
    straight: 'M15 3 7 11h5v16h6V11h5L15 3Z',
    uturn: 'M9 25v-9c0-4.4 3.6-8 8-8h2V3l8 7-8 7v-5h-2c-2.2 0-4 1.8-4 4v9H9Z'
  };

  element.innerHTML = `
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="${paths[direction] ?? paths.straight}"
        fill="#f59e0b" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
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

    // NavigationFeature calls showManeuvers on every GPS fix. Rebuilding the
    // same source/layers/marker each time makes the highlighted route segment
    // disappear for a frame and looks like the whole route is recalculating.
    // If the route and active maneuver are unchanged, keep the existing
    // overlay mounted exactly as it is.
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
          'line-width': 13,
          'line-opacity': 0.96
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
          'line-width': 8,
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
