const TURN_SOURCE = 'atlas-turn-highlight';
const TURN_CASING_LAYER = 'atlas-turn-highlight-casing';
const TURN_LAYER = 'atlas-turn-highlight-line';
const TURN_ARROW_SOURCE = 'atlas-turn-highlight-arrow';
const TURN_ARROW_CASING_LAYER = 'atlas-turn-highlight-arrow-casing';
const TURN_ARROW_LAYER = 'atlas-turn-highlight-arrow-line';

const TURN_HIGHLIGHT_BEFORE_METERS = 18;
const TURN_HIGHLIGHT_AFTER_METERS = 22;
const TURN_ARROW_TIP_METERS = 12;
const TURN_ARROW_WING_METERS = 5;

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

function multiLineFeature(lines) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: lines.map(line =>
        line.map(point => [point.lon, point.lat])
      )
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

function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return earthRadius * 2 * Math.atan2(
    Math.sqrt(h),
    Math.sqrt(Math.max(0, 1 - h))
  );
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

function destinationPoint(point, bearingDegrees, distance) {
  const earthRadiusMeters = 6371000;
  const angularDistance = distance / earthRadiusMeters;
  const bearingRadians = bearingDegrees * Math.PI / 180;
  const latitude1 = point.lat * Math.PI / 180;
  const longitude1 = point.lon * Math.PI / 180;

  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
    Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearingRadians)
  );
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude1),
    Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
  );

  return {
    lat: latitude2 * 180 / Math.PI,
    lon: longitude2 * 180 / Math.PI
  };
}

function interpolatePoint(from, to, fraction) {
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lon: from.lon + (to.lon - from.lon) * fraction
  };
}

function pointToward(from, to, distance) {
  const segmentDistance = distanceMeters(from, to);
  if (segmentDistance <= 0.01) return { ...from };
  return interpolatePoint(
    from,
    to,
    Math.max(0, Math.min(1, distance / segmentDistance))
  );
}

function compactTurnSegment(points, turnIndex) {
  const turn = points[turnIndex];
  if (!turn) return null;

  const incoming = [];
  let remainingBefore = TURN_HIGHLIGHT_BEFORE_METERS;
  let cursor = turn;

  for (let index = turnIndex - 1; index >= 0 && remainingBefore > 0; index -= 1) {
    const previous = points[index];
    const length = distanceMeters(previous, cursor);

    if (length >= remainingBefore) {
      incoming.unshift(pointToward(cursor, previous, remainingBefore));
      remainingBefore = 0;
      break;
    }

    incoming.unshift(previous);
    remainingBefore -= length;
    cursor = previous;
  }

  const outgoing = [];
  let remainingAfter = TURN_HIGHLIGHT_AFTER_METERS;
  cursor = turn;

  for (let index = turnIndex + 1; index < points.length && remainingAfter > 0; index += 1) {
    const next = points[index];
    const length = distanceMeters(cursor, next);

    if (length >= remainingAfter) {
      outgoing.push(pointToward(cursor, next, remainingAfter));
      remainingAfter = 0;
      break;
    }

    outgoing.push(next);
    remainingAfter -= length;
    cursor = next;
  }

  const segment = [...incoming, turn, ...outgoing];
  return segment.length >= 2 ? segment : null;
}

function pointAlongOutgoing(points, turnIndex, distance) {
  let remaining = distance;
  let cursor = points[turnIndex];

  for (let index = turnIndex + 1; index < points.length; index += 1) {
    const next = points[index];
    const length = distanceMeters(cursor, next);

    if (length >= remaining) {
      return {
        point: pointToward(cursor, next, remaining),
        routeBearing: bearing(cursor, next)
      };
    }

    remaining -= length;
    cursor = next;
  }

  const previous = points[Math.max(0, points.length - 2)];
  const last = points.at(-1);
  if (!previous || !last) return null;

  return {
    point: last,
    routeBearing: bearing(previous, last)
  };
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

  if (type.includes('roundabout') || type.includes('rotary')) return 'roundabout';
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

function routeArrowGeometry(points, turnIndex, direction) {
  if (direction === 'roundabout') return null;

  const outgoing = pointAlongOutgoing(
    points,
    turnIndex,
    TURN_ARROW_TIP_METERS
  );
  if (!outgoing) return null;

  const tip = outgoing.point;
  const routeBearing = outgoing.routeBearing;

  return [
    [tip, destinationPoint(tip, routeBearing + 150, TURN_ARROW_WING_METERS)],
    [tip, destinationPoint(tip, routeBearing - 150, TURN_ARROW_WING_METERS)]
  ];
}

function turnGeometry(route, maneuver) {
  const points = route?.points?.filter(validPoint) ?? [];
  if (points.length < 3 || !validPoint(maneuver?.location)) return null;

  const turnIndex = nearestRouteIndex(points, maneuver.location);
  const segment = compactTurnSegment(points, turnIndex);

  if (!segment) return null;

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
  const direction = maneuverDirection(maneuver, geometryDirection(delta));

  return {
    segment,
    direction,
    arrowLines: routeArrowGeometry(points, turnIndex, direction),
    delta
  };
}

function removeTurnOverlay(adapter) {
  for (const marker of adapter.maneuverMarkers ?? []) marker?.remove?.();
  adapter.maneuverMarkers = [];

  try {
    for (const layerId of [
      TURN_ARROW_LAYER,
      TURN_ARROW_CASING_LAYER,
      TURN_LAYER,
      TURN_CASING_LAYER
    ]) {
      if (adapter.map.getLayer?.(layerId)) adapter.map.removeLayer(layerId);
    }
    for (const sourceId of [TURN_ARROW_SOURCE, TURN_SOURCE]) {
      if (adapter.map.getSource?.(sourceId)) adapter.map.removeSource(sourceId);
    }
  } catch {
  }
}

function turnOverlayReady(adapter) {
  return Boolean(
    adapter.map.getSource?.(TURN_SOURCE) &&
    adapter.map.getLayer?.(TURN_LAYER) &&
    adapter.map.getLayer?.(TURN_CASING_LAYER)
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
          'line-width': 10,
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
          'line-width': 6,
          'line-opacity': 1
        }
      });

      if (geometry.arrowLines?.length) {
        this.map.addSource(TURN_ARROW_SOURCE, {
          type: 'geojson',
          data: collection([multiLineFeature(geometry.arrowLines)])
        });

        this.map.addLayer({
          id: TURN_ARROW_CASING_LAYER,
          type: 'line',
          source: TURN_ARROW_SOURCE,
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

        this.map.addLayer({
          id: TURN_ARROW_LAYER,
          type: 'line',
          source: TURN_ARROW_SOURCE,
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#ffffff',
            'line-width': 3,
            'line-opacity': 1
          }
        });
      }

      this.maneuverMarkers = [];
      this.__atlasTurnSignature = signature;
      this.__atlasTurnRoute = this.currentRoute;
      this.map.moveLayer?.(TURN_CASING_LAYER);
      this.map.moveLayer?.(TURN_LAYER);
      if (this.map.getLayer?.(TURN_ARROW_CASING_LAYER)) {
        this.map.moveLayer?.(TURN_ARROW_CASING_LAYER);
        this.map.moveLayer?.(TURN_ARROW_LAYER);
      }
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
