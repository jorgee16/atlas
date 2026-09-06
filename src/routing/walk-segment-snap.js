import {
  distanceMeters
} from '../features/navigation/navigation-geometry.js';

const WALK_SPEED_METERS_PER_SECOND = 1.4;
const MAX_CONNECTOR_METERS = 28;
const EPSILON_METERS = 0.05;
const DESTINATION_PROBE_RADII_METERS = [0, 40, 90, 160, 260, 400, 600];
const DESTINATION_PROBE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const EARTH_RADIUS_METERS = 6_371_000;

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

function projectOnPath(point, points) {
  let best = null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const projection = projectOnSegment(
      point,
      points[index],
      points[index + 1]
    );

    if (!best || projection.distanceMeters < best.distanceMeters) {
      best = {
        ...projection,
        segmentIndex: index,
        pathPosition: index + projection.fraction
      };
    }
  }

  return best;
}

function appendDistinct(points, point) {
  if (!point) return;

  const previous = points.at(-1);
  if (!previous || distanceMeters(previous, point) > EPSILON_METERS) {
    points.push({ lat: point.lat, lon: point.lon });
  }
}

function geometryDistance(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }

  return total;
}

function pathBetween(points, fromProjection, toProjection) {
  const forward =
    fromProjection.pathPosition <= toProjection.pathPosition;

  const start = forward ? fromProjection : toProjection;
  const end = forward ? toProjection : fromProjection;
  const output = [];

  appendDistinct(output, start.point);

  for (
    let index = start.segmentIndex + 1;
    index <= end.segmentIndex;
    index += 1
  ) {
    appendDistinct(output, points[index]);
  }

  appendDistinct(output, end.point);

  return forward ? output : output.reverse();
}

function projectionToPathStart(points, projection) {
  const output = [];

  appendDistinct(output, projection.point);

  for (let index = projection.segmentIndex; index >= 0; index -= 1) {
    appendDistinct(output, points[index]);
  }

  return output;
}

function pathStartToProjection(points, projection) {
  const output = [];

  appendDistinct(output, points[0]);

  for (let index = 1; index <= projection.segmentIndex; index += 1) {
    appendDistinct(output, points[index]);
  }

  appendDistinct(output, projection.point);
  return output;
}

function offsetPoint(point, bearingDegrees, distance) {
  if (distance === 0) return point;

  const angular = distance / EARTH_RADIUS_METERS;
  const bearing = bearingDegrees * Math.PI / 180;
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

function walkablePathsFromNode(graph, nodeIndex) {
  const paths = [];
  const seen = new Set();

  for (const edge of graph.outgoingEdges(nodeIndex)) {
    if (!edge.walkAllowed || seen.has(edge.edgeIndex)) continue;
    seen.add(edge.edgeIndex);

    const path = graph.routePath(nodeIndex, [edge.edgeIndex]);
    if ((path?.points?.length ?? 0) < 2) continue;

    paths.push({
      edge,
      points: path.points
    });
  }

  return paths;
}

function destinationCandidateNodes(graph, point, maxDistanceMeters) {
  const nodes = new Map();
  const maximumProbeRadius = Math.max(600, maxDistanceMeters * 12);

  for (const radius of DESTINATION_PROBE_RADII_METERS) {
    if (radius > maximumProbeRadius) continue;

    const bearings = radius === 0 ? [0] : DESTINATION_PROBE_BEARINGS;
    for (const bearing of bearings) {
      const nearest = graph.findNearest(
        offsetPoint(point, bearing, radius),
        {
          maxDistanceMeters: Math.max(160, radius + maxDistanceMeters),
          profile: 'walk'
        }
      );

      if (nearest) nodes.set(nearest.node, nearest);
    }
  }

  return [...nodes.values()];
}

export function findWalkDestinationRoadSegmentSnaps(
  graph,
  destination,
  {
    maxDistanceMeters = 80,
    maximumCandidates = 6,
    component = null
  } = {}
) {
  const candidates = [];
  const seenEdges = new Set();

  for (const nodeSnap of destinationCandidateNodes(
    graph,
    destination,
    maxDistanceMeters
  )) {
    if (
      Number.isInteger(component) &&
      nodeSnap.point.component !== component
    ) {
      continue;
    }

    for (const { edge, points } of walkablePathsFromNode(graph, nodeSnap.node)) {
      if (seenEdges.has(edge.edgeIndex)) continue;
      seenEdges.add(edge.edgeIndex);

      const projection = projectOnPath(destination, points);
      if (
        !projection ||
        projection.distanceMeters > maxDistanceMeters
      ) {
        continue;
      }

      const leadingPoints = pathStartToProjection(points, projection);
      const leadingDistanceMeters = geometryDistance(leadingPoints);
      const fullDistanceMeters = Math.max(edge.distanceDecimeters / 10, 0.01);
      const leadingFraction = Math.max(
        0,
        Math.min(1, leadingDistanceMeters / fullDistanceMeters)
      );
      const leadingDurationSeconds =
        edge.durationCentiseconds / 100 * leadingFraction;
      const road = graph.road(edge.road, edge.geometryReversed);

      candidates.push({
        node: nodeSnap.node,
        point: projection.point,
        distanceMeters: projection.distanceMeters,
        component: nodeSnap.point.component,
        edgeIndex: edge.edgeIndex,
        roadIndex: edge.road,
        road,
        roadClass: edge.roadClass,
        oneWay: edge.oneWay,
        fromNode: nodeSnap.node,
        toNode: edge.to,
        leadingPoints,
        leadingDistanceMeters,
        leadingDurationSeconds,
        snapStrategy: 'walk-road-segment-destination'
      });
    }
  }

  candidates.sort((a, b) =>
    a.distanceMeters - b.distanceMeters ||
    a.leadingDistanceMeters - b.leadingDistanceMeters ||
    a.roadClass - b.roadClass
  );

  return candidates.slice(0, maximumCandidates);
}

export function appendWalkSegmentToRoute(route, segmentSnap) {
  if (!route || !segmentSnap?.leadingPoints?.length) return route;

  const points = Array.isArray(route.points)
    ? route.points.map(point => ({ lat: point.lat, lon: point.lon }))
    : [];

  for (const point of segmentSnap.leadingPoints) {
    appendDistinct(points, point);
  }

  const distanceStart = route.distanceMeters ?? 0;
  const durationStart = route.durationSeconds ?? 0;
  const pointStartIndex = Math.max(0, (route.points?.length ?? 1) - 1);
  const distanceShift = segmentSnap.leadingDistanceMeters;
  const durationShift = segmentSnap.leadingDurationSeconds;

  // A projected destination can land exactly on the same routing node as the
  // origin. In that case A* returns a valid zero-edge route with one point and
  // the projected suffix is also zero length. Do not invent a partial edge:
  // keeping the route zero-edge lets OfflineRoutingService rebuild the short
  // walk from real adjacent walkable geometry before it reaches the renderer.
  if (points.length < 2 && distanceShift <= EPSILON_METERS) {
    return {
      ...route,
      destinationSegmentSnap: segmentSnap
    };
  }

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
    edgeIndexes: [
      ...(route.edgeIndexes ?? []),
      segmentSnap.edgeIndex
    ],
    legs: [...(route.legs ?? []), lastLeg],
    distanceMeters: distanceStart + distanceShift,
    durationSeconds: durationStart + durationShift,
    destinationSegmentSnap: segmentSnap
  };
}

export function buildShortWalkGeometry(
  graph,
  origin,
  destination,
  sharedNode
) {
  if (!graph || !Number.isInteger(sharedNode)) {
    return null;
  }

  const paths = walkablePathsFromNode(graph, sharedNode);
  if (!paths.length) return null;

  const projections = paths.map(path => ({
    ...path,
    originProjection: projectOnPath(origin, path.points),
    destinationProjection: projectOnPath(destination, path.points)
  }));

  // Best case: both endpoints lie on the same real walkable road segment.
  // Use only the stored road geometry between their projections.
  const samePath = projections
    .map(candidate => ({
      ...candidate,
      score:
        candidate.originProjection.distanceMeters +
        candidate.destinationProjection.distanceMeters
    }))
    .sort((a, b) => a.score - b.score)[0];

  if (
    samePath &&
    samePath.originProjection.distanceMeters <= MAX_CONNECTOR_METERS &&
    samePath.destinationProjection.distanceMeters <= MAX_CONNECTOR_METERS
  ) {
    const roadPoints = pathBetween(
      samePath.points,
      samePath.originProjection,
      samePath.destinationProjection
    );

    const points = [];
    appendDistinct(points, origin);
    for (const point of roadPoints) appendDistinct(points, point);
    appendDistinct(points, destination);

    const distance = geometryDistance(points);

    return {
      points,
      distanceMeters: distance,
      durationSeconds: distance / WALK_SPEED_METERS_PER_SECOND
    };
  }

  const originCandidate = projections
    .slice()
    .sort((a, b) =>
      a.originProjection.distanceMeters -
      b.originProjection.distanceMeters
    )[0];

  const destinationCandidate = projections
    .slice()
    .sort((a, b) =>
      a.destinationProjection.distanceMeters -
      b.destinationProjection.distanceMeters
    )[0];

  if (
    !originCandidate ||
    !destinationCandidate ||
    originCandidate.originProjection.distanceMeters > MAX_CONNECTOR_METERS ||
    destinationCandidate.destinationProjection.distanceMeters > MAX_CONNECTOR_METERS
  ) {
    return null;
  }

  // Different roads meeting at the shared routing node: follow each real road
  // into/out of the junction instead of drawing a direct V across buildings.
  const originRoad = projectionToPathStart(
    originCandidate.points,
    originCandidate.originProjection
  );

  const destinationRoad = pathStartToProjection(
    destinationCandidate.points,
    destinationCandidate.destinationProjection
  );

  const points = [];
  appendDistinct(points, origin);
  for (const point of originRoad) appendDistinct(points, point);
  for (const point of destinationRoad) appendDistinct(points, point);
  appendDistinct(points, destination);

  const distance = geometryDistance(points);

  return {
    points,
    distanceMeters: distance,
    durationSeconds: distance / WALK_SPEED_METERS_PER_SECOND
  };
}
