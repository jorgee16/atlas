const EARTH_RADIUS_METERS = 6_371_000;
const PROBE_RADII_METERS = [0, 30, 70, 120];
const DESTINATION_PROBE_RADII_METERS = [0, 40, 90, 160, 260, 400, 600];
const PROBE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

// Origin snapping should be proximity-led, but not proximity-blind. A local
// spur / cul-de-sac only wins when it is materially closer to the GPS fix.
// RoadClass is ordered with smaller values representing more important roads
// (motorway=1, trunk=2, primary=3 ...).
const DEAD_END_SNAP_PENALTY_METERS = 24;
const WEAK_CONNECTION_SNAP_PENALTY_METERS = 10;
const LINK_SNAP_PENALTY_METERS = 7;
const ROAD_CLASS_SNAP_PENALTY_METERS = 3.5;
const HEADING_SNAP_PENALTY_METERS_PER_DEGREE = 0.08;
const ROAD_CLASS_COMPARISON_RADIUS_METERS = 24;

function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(
    Math.sqrt(h),
    Math.sqrt(Math.max(0, 1 - h))
  );
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function bearingDegrees(from, to) {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

function headingDifference(a, b) {
  const delta = normalizeBearing(b) - normalizeBearing(a);
  return Math.abs(((delta + 540) % 360) - 180);
}

function offsetPoint(point, bearingDegreesValue, distance) {
  if (distance === 0) return point;

  const angular = distance / EARTH_RADIUS_METERS;
  const bearing = bearingDegreesValue * Math.PI / 180;
  const lat1 = point.lat * Math.PI / 180;
  const lon1 = point.lon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lon: lon2 * 180 / Math.PI
  };
}

function projectOnSegment(point, from, to) {
  const referenceLat = point.lat * Math.PI / 180;
  const xScale = 111_320 * Math.max(Math.cos(referenceLat), 0.01);
  const yScale = 111_320;

  const ax = (from.lon - point.lon) * xScale;
  const ay = (from.lat - point.lat) * yScale;
  const bx = (to.lon - point.lon) * xScale;
  const by = (to.lat - point.lat) * yScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  const fraction = lengthSquared > 0
    ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
    : 0;

  const projected = {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lon: from.lon + (to.lon - from.lon) * fraction
  };

  return {
    point: projected,
    fraction,
    distanceMeters: distanceMeters(point, projected)
  };
}

function leadingGeometry(points, segmentIndex, projectedPoint) {
  const output = [];

  for (let index = 0; index <= segmentIndex; index += 1) {
    const point = points[index];
    const previous = output[output.length - 1];
    if (!previous || distanceMeters(previous, point) > 0.05) {
      output.push(point);
    }
  }

  const previous = output[output.length - 1];
  if (!previous || distanceMeters(previous, projectedPoint) > 0.05) {
    output.push(projectedPoint);
  }

  return output;
}

function remainingGeometry(points, segmentIndex, projectedPoint) {
  const output = [projectedPoint];

  for (let index = segmentIndex + 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = output[output.length - 1];

    if (distanceMeters(previous, point) > 0.05) {
      output.push(point);
    }
  }

  return output;
}

function geometryBetweenSnaps(originSnap, destinationSnap) {
  const points = originSnap.pathPoints ?? [];
  if (
    originSnap.edgeIndex !== destinationSnap.edgeIndex ||
    points.length < 2 ||
    originSnap.segmentIndex > destinationSnap.segmentIndex
  ) {
    return null;
  }

  if (originSnap.segmentIndex === destinationSnap.segmentIndex) {
    if (originSnap.segmentFraction > destinationSnap.segmentFraction) {
      return null;
    }
    return [originSnap.point, destinationSnap.point];
  }

  const output = [originSnap.point];
  for (
    let index = originSnap.segmentIndex + 1;
    index <= destinationSnap.segmentIndex;
    index += 1
  ) {
    const point = points[index];
    const previous = output[output.length - 1];
    if (distanceMeters(previous, point) > 0.05) {
      output.push(point);
    }
  }

  const previous = output[output.length - 1];
  if (distanceMeters(previous, destinationSnap.point) > 0.05) {
    output.push(destinationSnap.point);
  }

  return output;
}

function geometryDistance(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }
  return total;
}

function driveDegree(graph, nodeIndex) {
  return new Set(
    graph.outgoingEdges(nodeIndex)
      .filter(edge => edge.driveAllowed)
      .map(edge => edge.to)
  ).size;
}

function candidateNodes(
  graph,
  point,
  maxDistanceMeters,
  {
    probeRadii = PROBE_RADII_METERS,
    maximumProbeRadiusMeters = Math.max(120, maxDistanceMeters * 4)
  } = {}
) {
  const nodes = new Map();

  for (const radius of probeRadii) {
    if (radius > maximumProbeRadiusMeters) continue;

    const bearings = radius === 0 ? [0] : PROBE_BEARINGS;
    for (const bearing of bearings) {
      const probe = offsetPoint(point, bearing, radius);
      const nearest = graph.findNearest(probe, {
        maxDistanceMeters: Math.max(160, radius + maxDistanceMeters),
        profile: 'drive'
      });

      if (nearest) nodes.set(nearest.node, nearest);
    }
  }

  return [...nodes.values()];
}

function snapPreferenceScore(
  candidate,
  {
    bestRoadClass,
    useHeading
  }
) {
  const hierarchyDifference = Math.max(
    0,
    Number(candidate.roadClass ?? bestRoadClass ?? 0) -
      Number(bestRoadClass ?? candidate.roadClass ?? 0)
  );

  return (
    candidate.distanceMeters +
    (candidate.deadEnd
      ? DEAD_END_SNAP_PENALTY_METERS
      : 0) +
    (candidate.weaklyConnected
      ? WEAK_CONNECTION_SNAP_PENALTY_METERS
      : 0) +
    (candidate.road?.link === true
      ? LINK_SNAP_PENALTY_METERS
      : 0) +
    hierarchyDifference *
      ROAD_CLASS_SNAP_PENALTY_METERS +
    (useHeading
      ? candidate.headingMismatchDegrees *
        HEADING_SNAP_PENALTY_METERS_PER_DEGREE
      : 0)
  );
}

function rankCandidates(candidates, { useHeading = false, maximumCandidates = 6 } = {}) {
  const directionCompatible = useHeading
    ? candidates.filter(candidate => candidate.headingMismatchDegrees <= 110)
    : candidates;

  const rankedCandidates = directionCompatible.length
    ? directionCompatible
    : candidates;

  const nearestDistance = rankedCandidates.reduce(
    (best, candidate) => Math.min(best, candidate.distanceMeters),
    Infinity
  );

  const bestRoadClass = rankedCandidates
    .filter(candidate =>
      candidate.distanceMeters <=
        nearestDistance + ROAD_CLASS_COMPARISON_RADIUS_METERS
    )
    .reduce(
      (best, candidate) =>
        Math.min(best, Number(candidate.roadClass ?? Infinity)),
      Infinity
    );

  rankedCandidates.sort((a, b) => {
    const aScore = snapPreferenceScore(a, { bestRoadClass, useHeading });
    const bScore = snapPreferenceScore(b, { bestRoadClass, useHeading });

    return (
      aScore - bScore ||
      a.distanceMeters - b.distanceMeters ||
      Number(a.deadEnd) - Number(b.deadEnd) ||
      Number(a.weaklyConnected) - Number(b.weaklyConnected) ||
      a.roadClass - b.roadClass ||
      a.headingMismatchDegrees - b.headingMismatchDegrees ||
      (a.remainingDistanceMeters ?? a.leadingDistanceMeters ?? 0) -
        (b.remainingDistanceMeters ?? b.leadingDistanceMeters ?? 0)
    );
  });

  const unique = [];
  const seen = new Set();
  for (const candidate of rankedCandidates) {
    const key = `${candidate.edgeIndex}:${candidate.point.lat.toFixed(6)}:${candidate.point.lon.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length >= maximumCandidates) break;
  }

  return unique;
}

function segmentCandidates(
  graph,
  point,
  {
    maxDistanceMeters,
    component = null,
    heading = null,
    speed = null,
    destination = false
  }
) {
  const directedEdges = new Set();
  const candidates = [];
  const effectiveHeading = Number.isFinite(heading) ? heading : point?.heading;
  const effectiveSpeed = Number.isFinite(speed) ? speed : point?.speed;
  const useHeading =
    !destination &&
    Number.isFinite(effectiveHeading) &&
    Number.isFinite(effectiveSpeed) &&
    effectiveSpeed >= 2;

  const probes = destination
    ? {
        probeRadii: DESTINATION_PROBE_RADII_METERS,
        maximumProbeRadiusMeters: Math.max(600, maxDistanceMeters * 12)
      }
    : undefined;

  for (const nodeSnap of candidateNodes(graph, point, maxDistanceMeters, probes)) {
    if (
      Number.isInteger(component) &&
      nodeSnap.point.component !== component
    ) {
      continue;
    }

    for (const edge of graph.outgoingEdges(nodeSnap.node)) {
      if (!edge.driveAllowed || directedEdges.has(edge.edgeIndex)) continue;
      directedEdges.add(edge.edgeIndex);

      const path = graph.routePath(nodeSnap.node, [edge.edgeIndex]);
      const points = path.points;
      if (points.length < 2) continue;

      let bestProjection = null;

      for (let index = 0; index < points.length - 1; index += 1) {
        const projection = projectOnSegment(point, points[index], points[index + 1]);
        if (
          !bestProjection ||
          projection.distanceMeters < bestProjection.distanceMeters
        ) {
          bestProjection = {
            ...projection,
            segmentIndex: index
          };
        }
      }

      if (
        !bestProjection ||
        bestProjection.distanceMeters > maxDistanceMeters
      ) {
        continue;
      }

      const leadingPoints = leadingGeometry(
        points,
        bestProjection.segmentIndex,
        bestProjection.point
      );
      const remainingPoints = remainingGeometry(
        points,
        bestProjection.segmentIndex,
        bestProjection.point
      );
      const leadingDistanceMeters = geometryDistance(leadingPoints);
      const remainingDistanceMeters = geometryDistance(remainingPoints);
      const fullDistanceMeters = Math.max(edge.distanceDecimeters / 10, 0.01);
      const leadingFraction = Math.max(0, Math.min(1, leadingDistanceMeters / fullDistanceMeters));
      const remainingFraction = Math.max(0, Math.min(1, remainingDistanceMeters / fullDistanceMeters));
      const leadingDurationSeconds = edge.durationCentiseconds / 100 * leadingFraction;
      const remainingDurationSeconds = edge.durationCentiseconds / 100 * remainingFraction;
      const road = graph.road(edge.road, edge.geometryReversed);
      const fromDegree = driveDegree(graph, nodeSnap.node);
      const toDegree = driveDegree(graph, edge.to);
      const deadEnd = fromDegree <= 1 || toDegree <= 1;
      const weaklyConnected = fromDegree <= 2 && toDegree <= 2;
      const travelHeading = remainingPoints.length >= 2
        ? bearingDegrees(remainingPoints[0], remainingPoints[1])
        : bearingDegrees(points[0], points[points.length - 1]);
      const headingMismatchDegrees = useHeading
        ? headingDifference(effectiveHeading, travelHeading)
        : 0;

      candidates.push({
        point: bestProjection.point,
        distanceMeters: bestProjection.distanceMeters,
        fromNode: nodeSnap.node,
        node: destination ? nodeSnap.node : edge.to,
        toNode: edge.to,
        edgeIndex: edge.edgeIndex,
        roadIndex: edge.road,
        road,
        roadClass: edge.roadClass,
        oneWay: edge.oneWay,
        fromDegree,
        toDegree,
        deadEnd,
        weaklyConnected,
        pathPoints: points,
        segmentIndex: bestProjection.segmentIndex,
        segmentFraction: bestProjection.fraction,
        leadingPoints,
        leadingDistanceMeters,
        leadingDurationSeconds,
        remainingPoints,
        remainingDistanceMeters,
        remainingDurationSeconds,
        component: nodeSnap.point.component,
        snapStrategy: destination ? 'road-segment-destination' : 'road-segment',
        travelHeading,
        headingMismatchDegrees
      });
    }
  }

  return { candidates, useHeading };
}

export function findDriveRoadSegmentSnaps(
  graph,
  point,
  {
    maxDistanceMeters = 45,
    maximumCandidates = 6,
    destinationComponent = null,
    heading = null,
    speed = null
  } = {}
) {
  const { candidates, useHeading } = segmentCandidates(graph, point, {
    maxDistanceMeters,
    component: destinationComponent,
    heading,
    speed,
    destination: false
  });

  return rankCandidates(candidates, { useHeading, maximumCandidates });
}

export function findDriveDestinationRoadSegmentSnaps(
  graph,
  point,
  {
    maxDistanceMeters = 55,
    maximumCandidates = 6,
    component = null
  } = {}
) {
  const { candidates } = segmentCandidates(graph, point, {
    maxDistanceMeters,
    component,
    destination: true
  });

  return rankCandidates(candidates, {
    useHeading: false,
    maximumCandidates
  });
}

export function prependDriveSegmentToRoute(route, segmentSnap) {
  if (!route || !segmentSnap?.remainingPoints?.length) return route;

  const prefix = segmentSnap.remainingPoints;
  const routePoints = Array.isArray(route.points) ? route.points : [];
  const points = [
    ...prefix,
    ...routePoints.slice(
      routePoints.length &&
      distanceMeters(prefix[prefix.length - 1], routePoints[0]) < 0.1
        ? 1
        : 0
    )
  ];

  const pointShift = prefix.length - 1;
  const distanceShift = segmentSnap.remainingDistanceMeters;
  const durationShift = segmentSnap.remainingDurationSeconds;

  const firstLeg = {
    edgeIndex: segmentSnap.edgeIndex,
    fromNode: segmentSnap.fromNode,
    toNode: segmentSnap.toNode,
    pointStartIndex: 0,
    pointEndIndex: prefix.length - 1,
    distanceMeters: distanceShift,
    durationSeconds: durationShift,
    routeDistanceStartMeters: 0,
    routeDistanceEndMeters: distanceShift,
    routeDurationStartSeconds: 0,
    routeDurationEndSeconds: durationShift,
    roadIndex: segmentSnap.roadIndex,
    road: segmentSnap.road,
    roadClass: segmentSnap.roadClass,
    oneWay: segmentSnap.oneWay,
    partial: true
  };

  const legs = [
    firstLeg,
    ...(route.legs ?? []).map(leg => ({
      ...leg,
      pointStartIndex: leg.pointStartIndex + pointShift,
      pointEndIndex: leg.pointEndIndex + pointShift,
      routeDistanceStartMeters: leg.routeDistanceStartMeters + distanceShift,
      routeDistanceEndMeters: leg.routeDistanceEndMeters + distanceShift,
      routeDurationStartSeconds: leg.routeDurationStartSeconds + durationShift,
      routeDurationEndSeconds: leg.routeDurationEndSeconds + durationShift
    }))
  ];

  return {
    ...route,
    points,
    legs,
    distanceMeters: route.distanceMeters + distanceShift,
    durationSeconds: route.durationSeconds + durationShift,
    originSegmentSnap: segmentSnap
  };
}

export function appendDriveSegmentToRoute(route, segmentSnap) {
  if (!route || !segmentSnap?.leadingPoints?.length) return route;

  const suffix = segmentSnap.leadingPoints;
  const routePoints = Array.isArray(route.points) ? route.points : [];
  const suffixStart =
    routePoints.length &&
    distanceMeters(routePoints[routePoints.length - 1], suffix[0]) < 0.1
      ? 1
      : 0;
  const points = [
    ...routePoints,
    ...suffix.slice(suffixStart)
  ];

  const pointStartIndex = Math.max(0, routePoints.length - 1);
  const distanceStart = route.distanceMeters;
  const durationStart = route.durationSeconds;
  const distanceShift = segmentSnap.leadingDistanceMeters;
  const durationShift = segmentSnap.leadingDurationSeconds;

  const lastLeg = {
    edgeIndex: segmentSnap.edgeIndex,
    fromNode: segmentSnap.fromNode,
    toNode: segmentSnap.toNode,
    pointStartIndex,
    pointEndIndex: points.length - 1,
    distanceMeters: distanceShift,
    durationSeconds: durationShift,
    routeDistanceStartMeters: distanceStart,
    routeDistanceEndMeters: distanceStart + distanceShift,
    routeDurationStartSeconds: durationStart,
    routeDurationEndSeconds: durationStart + durationShift,
    roadIndex: segmentSnap.roadIndex,
    road: segmentSnap.road,
    roadClass: segmentSnap.roadClass,
    oneWay: segmentSnap.oneWay,
    partial: true
  };

  return {
    ...route,
    points,
    legs: [...(route.legs ?? []), lastLeg],
    distanceMeters: distanceStart + distanceShift,
    durationSeconds: durationStart + durationShift,
    destinationSegmentSnap: segmentSnap
  };
}

export function buildDriveRouteBetweenSegmentSnaps(originSnap, destinationSnap) {
  const points = geometryBetweenSnaps(originSnap, destinationSnap);
  if (!points?.length) return null;

  const distance = geometryDistance(points);
  const fullDistance = Math.max(
    originSnap.remainingDistanceMeters + originSnap.leadingDistanceMeters,
    0.01
  );
  const duration =
    (originSnap.remainingDurationSeconds + originSnap.leadingDurationSeconds) *
    Math.max(0, Math.min(1, distance / fullDistance));

  return {
    nodeIndexes: [],
    edgeIndexes: [originSnap.edgeIndex],
    points,
    legs: [{
      edgeIndex: originSnap.edgeIndex,
      fromNode: originSnap.fromNode,
      toNode: originSnap.toNode,
      pointStartIndex: 0,
      pointEndIndex: points.length - 1,
      distanceMeters: distance,
      durationSeconds: duration,
      routeDistanceStartMeters: 0,
      routeDistanceEndMeters: distance,
      routeDurationStartSeconds: 0,
      routeDurationEndSeconds: duration,
      roadIndex: originSnap.roadIndex,
      road: originSnap.road,
      roadClass: originSnap.roadClass,
      oneWay: originSnap.oneWay,
      partial: true
    }],
    distanceMeters: distance,
    durationSeconds: duration,
    originSegmentSnap: originSnap,
    destinationSegmentSnap: destinationSnap
  };
}
