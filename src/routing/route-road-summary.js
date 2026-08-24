function normalizeRoadReference(value) {
  const compact = String(value ?? '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '');

  if (!compact) return '';

  return compact
    .replace(/^ESTRADAMUNICIPAL(?=\d)/, 'EM')
    .replace(/^ESTRADANACIONAL(?=\d)/, 'EN')
    .replace(/^ITINERARIOCOMPLEMENTAR(?=\d)/, 'IC')
    .replace(/^ITINERARIOPRINCIPAL(?=\d)/, 'IP');
}

function cleanRoadReferences(value) {
  return String(value ?? '')
    .split(/[;,/]/)
    .map(normalizeRoadReference)
    .filter(Boolean);
}

/**
 * Return a compact ordered list of the principal signed road references used
 * by a route (for example A2 · A22 · N125). Short access roads are filtered
 * out so the hint describes the shape of the journey rather than every edge.
 */
export function summarizeRouteRoadRefs(
  graph,
  route,
  { limit = 4 } = {}
) {
  const edgeIndexes = route?.edgeIndexes ?? [];

  if (!graph || !edgeIndexes.length || limit <= 0) {
    return [];
  }

  const byRef = new Map();

  edgeIndexes.forEach((edgeIndex, order) => {
    const roadIndex = graph.edgeRoad?.(edgeIndex);
    if (!Number.isInteger(roadIndex)) return;

    const road = graph.road?.(roadIndex);
    const refs = cleanRoadReferences(road?.ref);
    if (!refs.length) return;

    const distanceMeters = Math.max(
      0,
      Number(graph.edgeDistanceDecimeters?.(edgeIndex) ?? 0) / 10
    );

    for (const ref of refs) {
      const existing = byRef.get(ref);
      if (existing) {
        existing.distanceMeters += distanceMeters;
        continue;
      }

      byRef.set(ref, {
        ref,
        order,
        distanceMeters
      });
    }
  });

  if (!byRef.size) return [];

  const routeDistance = Math.max(
    0,
    Number(route?.distanceMeters ?? 0)
  );

  // A reference should account for a meaningful part of the journey. Keep
  // the threshold low enough that important approach/exit roads still show.
  const meaningfulDistance = Math.min(
    5000,
    Math.max(500, routeDistance * 0.015)
  );

  let candidates = [...byRef.values()].filter(
    entry => entry.distanceMeters >= meaningfulDistance
  );

  // Very short routes can legitimately have no road above the threshold.
  if (!candidates.length) {
    candidates = [...byRef.values()];
  }

  return candidates
    .sort((a, b) => b.distanceMeters - a.distanceMeters)
    .slice(0, limit)
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.ref);
}
