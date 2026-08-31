const EARTH_RADIUS_METERS = 6_371_000;
const PROBE_RADII_METERS = [0, 30, 70, 120];
const PROBE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

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

function candidateNodes(graph, point, maxDistanceMeters) {
  const nodes = new Map();

  for (const radius of PROBE_RADII_METERS) {
    if (radius > Math.max(120, maxDistanceMeters * 4)) continue;

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
  const directedEdges = new Set();
  const candidates = [];
  const effectiveHeading = Number.isFinite(heading)
    ? heading
    : point?.heading;
  const effectiveSpeed = Number.isFinite(speed)
    ? speed
    : point?.speed;
  const useHeading =
    Number.isFinite(effectiveHeading) &&
    Number.isFinite(effectiveSpeed) &&
    effectiveSpeed >= 2;

  for (const nodeSnap of candidateNodes(graph, point, maxDistanceMeters)) {
    if (
      Number.isInteger(destinationComponent) &&
      nodeSnap.point.component !== destinationComponent
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

      const remainingPoints = remainingGeometry(
        points,
        bestProjection.segmentIndex,
        bestProjection.point
      );
      const remainingDistanceMeters = geometryDistance(remainingPoints);
      const fullDistanceMeters = Math.max(edge.distanceDecimeters / 10, 0.01);
      const remainingFraction = Math.max(
        0,
        Math.min(1, remainingDistanceMeters / fullDistanceMeters)
      );
      const remainingDurationSeconds =
        edge.durationCentiseconds / 100 * remainingFraction;
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
        node: edge.to,
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
        remainingPoints,
        remainingDistanceMeters,
        remainingDurationSeconds,
        component: nodeSnap.point.component,
        snapStrategy: 'road-segment',
        travelHeading,
        headingMismatchDegrees
      });
    }
  }

  candidates.sort((a, b) =>
    Number(a.deadEnd) - Number(b.deadEnd) ||
    a.headingMismatchDegrees - b.headingMismatchDegrees ||
    a.distanceMeters - b.distanceMeters ||
    Number(a.road?.link === true) - Number(b.road?.link === true) ||
    b.roadClass - a.roadClass ||
    a.remainingDistanceMeters - b.remainingDistanceMeters
  );

  const directionCompatible = useHeading
    ? candidates.filter(candidate => candidate.headingMismatchDegrees <= 110)
    : candidates;
  const rankedCandidates = directionCompatible.length
    ? directionCompatible
    : candidates;

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
