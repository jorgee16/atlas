/* Compatibility module name. All prices come from country tables; no national defaults. */
export function tollRateEurosPerKm(roadReference, vehicleClass = 1, tariffs = null) {
  return tariffs?.estimate(roadReference, 1000, vehicleClass) ?? null;
}
export function estimateEdgeTollEuros(graph, edgeIndex, vehicleClass = 1, tariffs = null) {
  if (!graph.edgeIsToll?.(edgeIndex)) return 0;
  const road = graph.road(graph.edgeRoad(edgeIndex));
  return tariffs?.estimate(road.ref, graph.edgeDistanceDecimeters(edgeIndex) / 10, vehicleClass) ?? null;
}
export function estimateRouteTolls(graph, route, { vehicleClass = 1, tariffs = null } = {}) {
  let sum = 0, tolledDistanceMeters = 0, pricedTollMeters = 0, complete = true;
  const roads = new Map();
  const scale = 10 ** (tariffs?.fractionDigits ?? 2), round = n => Math.round(n * scale) / scale;
  for (const index of route?.edgeIndexes ?? []) {
    if (!graph.edgeIsToll?.(index)) continue;
    const road = graph.road(graph.edgeRoad(index)), meters = graph.edgeDistanceDecimeters(index) / 10;
    const amount = estimateEdgeTollEuros(graph, index, vehicleClass, tariffs);
    const key = road.ref || road.name || 'Toll road';
    const item = roads.get(key) ?? { road: key, distanceMeters: 0, pricedMeters: 0, euros: 0, complete: true };
    item.distanceMeters += meters; tolledDistanceMeters += meters;
    if (amount === null) { complete = false; item.complete = false; }
    else { sum += amount; pricedTollMeters += meters; item.pricedMeters += meters; item.euros += amount; }
    roads.set(key, item);
  }
  const total = complete ? round(sum) : null;
  return { vehicleClass, estimated: tolledDistanceMeters > 0 && complete,
    pricing: !tolledDistanceMeters ? 'none' : complete ? 'estimate' : 'unavailable',
    totalEuros: total, amount: total, country: tariffs?.country ?? '', currency: tariffs?.currency ?? '',
    year: tariffs?.year ?? '', source: tariffs?.source ?? '', version: tariffs?.version ?? '',
    tolledDistanceMeters, pricedTollMeters,
    roads: [...roads.values()].map(item => ({ ...item, euros: item.complete ? round(item.euros) : null,
      pricing: item.complete ? 'estimate' : 'unavailable' })) };
}
