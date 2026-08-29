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

function activeManeuver(maneuvers, activeIndex) {
  return maneuvers
    .slice(Math.max(0, activeIndex))
    .find(item => item?.type !== 'depart' && validPoint(item?.location));
}

function turnGeometry(route, maneuver) {
  const points = route?.points?.filter(validPoint) ?? [];
  if (points.length < 2 || !validPoint(maneuver?.location)) return null;

  const turnIndex = nearestRouteIndex(points, maneuver.location);
  const startIndex = Math.max(0, turnIndex - 2);
  const endIndex = Math.min(points.length - 1, turnIndex + 3);
  const segment = points.slice(startIndex, endIndex + 1);

  if (segment.length < 2) return null;

  const outgoingIndex = Math.min(points.length - 1, turnIndex + 1);
  const incomingIndex = Math.max(0, Math.min(turnIndex, points.length - 2));
  const arrowFrom = points[incomingIndex];
  const arrowTo = points[outgoingIndex];

  return {
    segment,
    arrowBearing: bearing(arrowFrom, arrowTo)
  };
}

function arrowElement(rotation) {
  const element = document.createElement('div');
  element.style.cssText = [
    'width:26px',
    'height:26px',
    'display:grid',
    'place-items:center',
    `transform:rotate(${rotation}deg)`,
    'filter:drop-shadow(0 2px 3px rgba(0,0,0,.28))',
    'pointer-events:none'
  ].join(';');
  element.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 20 19.5 12 16.1 4 19.5 12 2.5Z"
        fill="#f59e0b" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
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
    removeTurnOverlay(this);

    if (!Array.isArray(maneuvers)) return;

    const maneuver = activeManeuver(maneuvers, activeIndex);
    const geometry = turnGeometry(this.currentRoute, maneuver);
    if (!maneuver || !geometry) return;

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
        element: arrowElement(geometry.arrowBearing),
        anchor: 'center',
        rotationAlignment: 'map'
      })
        .setLngLat([maneuver.location.lon, maneuver.location.lat])
        .addTo(this.map);

      this.maneuverMarkers = [marker];
      this.map.moveLayer?.(TURN_CASING_LAYER);
      this.map.moveLayer?.(TURN_LAYER);
      this.map.triggerRepaint?.();
    } catch (error) {
      console.warn('Unable to render MapLibre turn highlight.', error);
    }
  };

  AdapterClass.prototype.clearManeuvers = function clearManeuvers() {
    this.currentManeuvers = null;
    this.currentManeuverIndex = 0;
    removeTurnOverlay(this);
  };
}
