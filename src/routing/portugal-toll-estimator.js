/*
 * Portugal toll estimation.
 *
 * Preferred path: audited per-partition toll events carry official tariffs.
 * The event dataset is not yet nationally exhaustive, so edges without an
 * audited event still fall back to the routing graph's OSM toll flag. This is
 * important both for estimates and for avoid-tolls routing: the presence of a
 * partial official event index must never make every uncovered motorway look
 * free.
 */

const CLASS_MULTIPLIERS = Object.freeze({
  1: 1,
  2: 1.75,
  3: 2.25,
  4: 2.5
});

const CLASS1_EUROS_PER_KM = Object.freeze({
  A1: 0.073,
  A2: 0.074,
  A3: 0.099,
  A4: 0.096,
  A5: 0.105,
  A6: 0.110,
  A8: 0.080,
  A9: 0.108,
  A10: 0.109,
  A11: 0.080,
  A12: 0.080,
  A13: 0.080,
  A14: 0.080,
  A15: 0.107,
  A16: 0.080,
  A17: 0.108,
  A19: 0.080,
  A21: 0.080,
  A23: 0.080,
  A24: 0.080,
  A25: 0.080,
  A28: 0.080,
  A29: 0.080,
  A32: 0.080,
  A33: 0.080,
  A41: 0.080,
  A42: 0.080,
  A43: 0.080
});

const DEFAULT_CLASS1_EUROS_PER_KM = 0.08;

function normalizedRoadRefs(value) {
  return String(value ?? '')
    .toUpperCase()
    .split(/[;,/]/)
    .map(part => part.trim().replace(/\s+/g, ''))
    .filter(Boolean);
}

function roadForEdge(graph, edgeIndex) {
  if (
    typeof graph?.edgeRoad !== 'function' ||
    typeof graph?.road !== 'function'
  ) {
    return null;
  }

  return graph.road(
    graph.edgeRoad(edgeIndex)
  );
}

function officialIndex(graph) {
  return graph?.tollEvents?.available
    ? graph.tollEvents
    : null;
}

function officialEdgeHasEvent(graph, edgeIndex) {
  const official = officialIndex(graph);
  return Boolean(
    official &&
    official.eventsForEdge(edgeIndex).length
  );
}

export function edgeIsTolledInPortugal(
  graph,
  edgeIndex,
  vehicleClass = 1
) {
  const official = officialIndex(graph);

  if (
    official &&
    official.edgeHasCharge(edgeIndex, vehicleClass)
  ) {
    return true;
  }

  // The audited event index is intentionally allowed to be partial. For an
  // uncovered edge, preserve the graph's OSM toll semantics rather than
  // silently treating it as free.
  return Boolean(graph?.edgeIsToll?.(edgeIndex));
}

export function tollRateEurosPerKm(
  roadReference,
  vehicleClass = 1
) {
  const multiplier =
    CLASS_MULTIPLIERS[vehicleClass] ??
    CLASS_MULTIPLIERS[1];

  const refs = normalizedRoadRefs(roadReference);
  const class1Rate = refs
    .map(ref => CLASS1_EUROS_PER_KM[ref])
    .find(Number.isFinite) ??
    DEFAULT_CLASS1_EUROS_PER_KM;

  return class1Rate * multiplier;
}

function estimateOsmEdgeTollEuros(
  graph,
  edgeIndex,
  vehicleClass = 1
) {
  if (!graph?.edgeIsToll?.(edgeIndex)) {
    return 0;
  }

  const road = roadForEdge(graph, edgeIndex);
  if (!road) return 0;

  const kilometers =
    graph.edgeDistanceDecimeters(edgeIndex) /
    10_000;

  return kilometers *
    tollRateEurosPerKm(
      road.ref,
      vehicleClass
    );
}

export function estimateEdgeTollEuros(
  graph,
  edgeIndex,
  vehicleClass = 1
) {
  const official = officialIndex(graph);
  if (
    official &&
    official.edgeHasCharge(edgeIndex, vehicleClass)
  ) {
    return official.edgeChargeEuros(
      edgeIndex,
      vehicleClass
    );
  }

  return estimateOsmEdgeTollEuros(
    graph,
    edgeIndex,
    vehicleClass
  );
}

function estimateHybridRouteTolls(
  graph,
  route,
  vehicleClass
) {
  const official = graph.tollEvents;
  const charges = official.routeCharges(
    route?.edgeIndexes ?? [],
    vehicleClass
  );

  const officialEdges = new Set(
    charges.map(charge => charge.edgeIndex)
  );
  const roads = new Map();
  let officialEuros = 0;
  let fallbackEuros = 0;
  let tolledDistanceMeters = 0;
  let fallbackEdgeCount = 0;

  for (const charge of charges) {
    officialEuros += charge.euros;
    const key = charge.roadRef || 'Toll';
    const current = roads.get(key) ?? {
      road: key,
      distanceMeters: 0,
      euros: 0,
      events: []
    };

    current.euros += charge.euros;
    current.events.push({
      id: charge.id,
      euros: charge.euros,
      system: charge.system,
      operator: charge.operator,
      edgeIndex: charge.edgeIndex
    });
    roads.set(key, current);
  }

  for (const edgeIndex of route?.edgeIndexes ?? []) {
    if (
      officialEdges.has(edgeIndex) ||
      officialEdgeHasEvent(graph, edgeIndex) ||
      !graph?.edgeIsToll?.(edgeIndex)
    ) {
      continue;
    }

    const road = roadForEdge(graph, edgeIndex);
    if (!road) continue;

    const distanceMeters =
      graph.edgeDistanceDecimeters(edgeIndex) /
      10;
    const euros = estimateOsmEdgeTollEuros(
      graph,
      edgeIndex,
      vehicleClass
    );

    if (euros <= 0) continue;

    fallbackEdgeCount += 1;
    fallbackEuros += euros;
    tolledDistanceMeters += distanceMeters;

    const key = road.ref || road.name || 'Toll road';
    const current = roads.get(key) ?? {
      road: key,
      distanceMeters: 0,
      euros: 0,
      events: []
    };

    current.distanceMeters += distanceMeters;
    current.euros += euros;
    roads.set(key, current);
  }

  const totalEuros = officialEuros + fallbackEuros;

  return {
    vehicleClass,
    estimated: fallbackEdgeCount > 0,
    source:
      fallbackEdgeCount > 0
        ? 'official-events+osm-estimate'
        : 'official-events',
    totalEuros:
      Math.round(totalEuros * 100) / 100,
    tolledDistanceMeters,
    events: charges,
    fallbackEdgeCount,
    roads: [...roads.values()].map(item => ({
      ...item,
      euros: Math.round(item.euros * 100) / 100
    }))
  };
}

export function estimateRouteTolls(
  graph,
  route,
  {
    vehicleClass = 1
  } = {}
) {
  if (officialIndex(graph)) {
    return estimateHybridRouteTolls(
      graph,
      route,
      vehicleClass
    );
  }

  let totalEuros = 0;
  let tolledDistanceMeters = 0;
  const roads = new Map();

  for (const edgeIndex of route?.edgeIndexes ?? []) {
    if (!edgeIsTolledInPortugal(graph, edgeIndex, vehicleClass)) {
      continue;
    }

    const road = roadForEdge(graph, edgeIndex);
    if (!road) continue;

    const distanceMeters =
      graph.edgeDistanceDecimeters(edgeIndex) /
      10;

    const euros = estimateEdgeTollEuros(
      graph,
      edgeIndex,
      vehicleClass
    );

    totalEuros += euros;
    tolledDistanceMeters += distanceMeters;

    const key = road.ref || road.name || 'Toll road';
    const current = roads.get(key) ?? {
      road: key,
      distanceMeters: 0,
      euros: 0
    };

    current.distanceMeters += distanceMeters;
    current.euros += euros;
    roads.set(key, current);
  }

  return {
    vehicleClass,
    estimated: totalEuros > 0,
    source: 'osm-estimate',
    totalEuros:
      Math.round(totalEuros * 100) / 100,
    tolledDistanceMeters,
    roads: [...roads.values()].map(item => ({
      ...item,
      euros: Math.round(item.euros * 100) / 100
    }))
  };
}
