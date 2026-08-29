/*
 * Portugal 2026 toll estimator.
 *
 * The binary graph preserves OSM toll tags, but some Portuguese concessions
 * are not consistently tagged on every individual OSM way. Runtime routing
 * therefore keeps a deliberately small, evidence-backed fallback list for
 * concessions that are known to be tolled and whose road reference is carried
 * by the graph. This also fixes already-downloaded region packages without
 * requiring users to rebuild/re-download them immediately.
 */

const CLASS_MULTIPLIERS = Object.freeze({
  1: 1,
  2: 1.75,
  3: 2.25,
  4: 2.5
});

/* Approximate Class-1 euro/km rates from 2026 published concession tariffs. */
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

// Ascendi's Grande Lisboa concession identifies the A16 as a tolled road with
// traditional toll collection. Keep this targeted rather than assuming every
// motorway reference in the generic tariff table is tolled end-to-end: several
// Portuguese motorways contain free sections.
const KNOWN_TOLLED_ROAD_REFS = new Set([
  'A16'
]);

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

export function edgeIsTolledInPortugal(
  graph,
  edgeIndex
) {
  if (graph?.edgeIsToll?.(edgeIndex)) {
    return true;
  }

  const road = roadForEdge(graph, edgeIndex);
  if (!road) return false;

  return normalizedRoadRefs(road.ref).some(
    ref => KNOWN_TOLLED_ROAD_REFS.has(ref)
  );
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

export function estimateEdgeTollEuros(
  graph,
  edgeIndex,
  vehicleClass = 1
) {
  if (!edgeIsTolledInPortugal(graph, edgeIndex)) {
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

export function estimateRouteTolls(
  graph,
  route,
  {
    vehicleClass = 1
  } = {}
) {
  let totalEuros = 0;
  let tolledDistanceMeters = 0;
  const roads = new Map();

  for (const edgeIndex of route?.edgeIndexes ?? []) {
    if (!edgeIsTolledInPortugal(graph, edgeIndex)) {
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
    totalEuros:
      Math.round(totalEuros * 100) / 100,
    tolledDistanceMeters,
    roads: [...roads.values()].map(item => ({
      ...item,
      euros: Math.round(item.euros * 100) / 100
    }))
  };
}
