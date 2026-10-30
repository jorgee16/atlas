import { bearingDegrees, distanceMeters } from '../features/navigation/navigation-geometry.js';

const ROAD_CLASS_SPEED_CAP_KMH = Object.freeze({
  1: 110, // motorway
  2: 90,  // trunk
  3: 55,  // primary
  4: 50,  // secondary
  5: 45,  // tertiary
  6: 28,  // residential
  7: 18,  // service
  8: 12,  // track
  9: 35   // other / unclassified
});

const LONG_ROUTE_SPEED_CAP_KMH = Object.freeze({
  ...ROAD_CLASS_SPEED_CAP_KMH,
  3: 65,
  4: 60,
  5: 50,
  9: 40
});

function speedCapMetersPerSecond(roadClass, distanceMeters) {
  const caps = distanceMeters <= 15_000
    ? ROAD_CLASS_SPEED_CAP_KMH
    : LONG_ROUTE_SPEED_CAP_KMH;

  return (caps[roadClass] ?? 35) / 3.6;
}

function refs(value) {
  return new Set(String(value ?? '').split(/[;,/]/)
    .map(ref => ref.replace(/\s+/g, '').toUpperCase()).filter(Boolean));
}
function sameRoad(a, b) {
  const ar=refs(a?.ref), br=refs(b?.ref);
  if (ar.size || br.size) return [...ar].some(ref => br.has(ref));
  return Boolean(a?.name) && a.name===b?.name;
}
function legBearing(route, leg, atEnd) {
  const points=route.points, first=leg.pointStartIndex, last=leg.pointEndIndex;
  if (!points || !Number.isInteger(first) || !Number.isInteger(last) ||
      first<0 || first>=last || last>=points.length) return null;
  if (atEnd) {
    for(let i=last;i>first;i--) if(distanceMeters(points[i-1],points[last])>.1)
      return bearingDegrees(points[i-1],points[last]);
  } else {
    for(let i=first+1;i<=last;i++) if(distanceMeters(points[first],points[i])>.1)
      return bearingDegrees(points[first],points[i]);
  }
  return null;
}
function continuesRoad(route, previous, current, graph) {
  if (previous.toNode!==current.fromNode || previous.fromNode===current.toNode) return false;
  if (['link','toll','electronicToll'].some(key => Boolean(previous.road?.[key])!==Boolean(current.road?.[key]))) return false;
  if (previous.road?.roundabout && current.road?.roundabout) return true;
  if (Boolean(previous.road?.roundabout)!==Boolean(current.road?.roundabout) ||
      previous.roadClass!==current.roadClass ||
      Boolean(previous.road?.link)!==Boolean(current.road?.link) ||
      !sameRoad(previous.road,current.road)) return false;
  const incoming=legBearing(route,previous,true),outgoing=legBearing(route,current,false);
  if(incoming===null || outgoing===null || Math.abs((outgoing-incoming+540)%360-180)>25)
    return false;
  if(current.roadClass>2) {
    if (!graph?.outgoingEdges || graph.hasTurnRestrictions?.(current.fromNode)) return false;
    if(graph.outgoingEdges(current.fromNode).some(edge=>edge.driveAllowed &&
        edge.to!==previous.fromNode && edge.to!==current.toNode)) return false;
  }
  return true;
}
function transitionDelaySeconds(previous, current, route, graph) {
  if (!previous || previous.roadIndex === current.roadIndex ||
      continuesRoad(route, previous, current, graph)) {
    return 0;
  }

  if (current.road?.roundabout || previous.road?.roundabout) {
    return 7;
  }

  const fastestClass = Math.min(
    Number(previous.roadClass ?? 9),
    Number(current.roadClass ?? 9)
  );

  if (fastestClass <= 2) return 2;
  if (fastestClass <= 4) return 4;
  return 6;
}

/**
 * Convert graph free-flow durations into a conservative real-world drive ETA.
 * This deliberately does not alter the path chosen by A*: it only models the
 * fact that a car cannot sustain the posted/default speed continuously through
 * short urban routes, road changes and junctions.
 */
export function calibrateDriveEta(route, graph = null) {
  if (!route || !Array.isArray(route.legs) || !route.legs.length) {
    return route;
  }

  const totalDistance = Number(route.distanceMeters ?? 0);
  let elapsed = 0;
  let previous = null;

  const calibratedLegs = route.legs.map((leg, index) => {
    const distance = Math.max(0, Number(leg.distanceMeters ?? 0));
    const freeFlow = Math.max(0, Number(leg.durationSeconds ?? 0));
    const cap = speedCapMetersPerSecond(leg.roadClass, totalDistance);
    const capped = cap > 0 ? distance / cap : freeFlow;
    const transition = transitionDelaySeconds(previous, leg, route, graph);

    // A short route has unavoidable pull-away / arrival overhead that a pure
    // edge-speed sum does not model. Keep it small and bounded.
    const endpointDelay = totalDistance <= 15_000
      ? (index === 0 ? 10 : 0) + (index === route.legs.length - 1 ? 10 : 0)
      : 0;

    const durationSeconds = Math.max(freeFlow, capped) + transition + endpointDelay;
    const routeDurationStartSeconds = elapsed;
    elapsed += durationSeconds;

    previous = leg;

    return {
      ...leg,
      freeFlowDurationSeconds: freeFlow,
      durationSeconds,
      routeDurationStartSeconds,
      routeDurationEndSeconds: elapsed
    };
  });

  return {
    ...route,
    freeFlowDurationSeconds: Number(route.durationSeconds ?? 0),
    legs: calibratedLegs,
    durationSeconds: elapsed
  };
}
