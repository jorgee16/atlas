/* Compatibility module name. Country catalog estimates with an explicit, opt-in low-confidence reference policy. */
export function tollRateEurosPerKm(roadReference, vehicleClass = 1, tariffs = null) {
  return tariffs?.estimate(roadReference, 1000, vehicleClass) ?? null;
}
export function estimateEdgeTollEuros(graph, edgeIndex, vehicleClass = 1, tariffs = null) {
  if (!graph.edgeIsToll?.(edgeIndex)) return 0;
  const road = graph.road(graph.edgeRoad(edgeIndex));
  return tariffs?.estimate(road.ref, graph.edgeDistanceDecimeters(edgeIndex) / 10, vehicleClass) ?? null;
}
export function estimateRouteTolls(graph, route, { vehicleClass = 1, tariffs = null } = {}) {
  let sum = 0, tolledDistanceMeters = 0, pricedTollMeters = 0, complete = true, allExplicitlyFree = true, referenceTollMeters = 0;
  const freeSources = new Set();
  const roads = new Map();
  const scale = 10 ** (tariffs?.fractionDigits ?? 2), round = n => Math.round(n * scale) / scale;
  for (const index of route?.edgeIndexes ?? []) {
    if (!graph.edgeIsToll?.(index)) continue;
    const road = graph.road(graph.edgeRoad(index)), meters = graph.edgeDistanceDecimeters(index) / 10;
    const free=tariffs?.explicitlyFree(road.ref,vehicleClass)??false;
    allExplicitlyFree &&= free; if(free)freeSources.add(tariffs.freeSourceFor(road.ref,vehicleClass));
    const knownAmount = estimateEdgeTollEuros(graph, index, vehicleClass, tariffs);
    const reference = knownAmount===null ? (tariffs?.referenceEstimate(road.ref,meters,vehicleClass)??null) : null;
    const amount = knownAmount??reference;
    const key = road.ref || road.name || 'Toll road';
    const item = roads.get(key) ?? { road: key, distanceMeters: 0, pricedMeters: 0, euros: 0, complete: true, exact: true, referenceMeters:0 };
    item.exact &&= free;
    item.distanceMeters += meters; tolledDistanceMeters += meters;
    if (amount === null) { complete = false; item.complete = false; }
    else { sum += amount; if(reference!==null){referenceTollMeters+=meters;item.referenceMeters+=meters;}else{pricedTollMeters += meters; item.pricedMeters += meters;} item.euros += amount; }
    roads.set(key, item);
  }
  const money=(amount,referenceMeters)=>referenceMeters>0&&amount>0?Math.max(1/scale,round(amount)):round(amount);
  const total = complete ? money(sum,referenceTollMeters) : null;
  return { vehicleClass, estimated: tolledDistanceMeters > 0 && complete && !allExplicitlyFree,
    pricing: !tolledDistanceMeters ? 'none' : complete ? (allExplicitlyFree ? 'exact' : 'estimate') : 'unavailable',
    totalEuros: total, amount: total, country: tariffs?.country ?? '', currency: tariffs?.currency ?? '',
    year: tariffs?.year ?? '', source: [tariffs?.source,...freeSources].filter(Boolean).join('\n'), version: tariffs?.version ?? '',
    tolledDistanceMeters, pricedTollMeters, referenceTollMeters,
    pricingConfidence: !tolledDistanceMeters?'none':!complete?'unavailable':allExplicitlyFree&&tolledDistanceMeters?'exact':referenceTollMeters>0?'low':'standard',
    estimationMethod:!complete?'unavailable':!tolledDistanceMeters?'none':referenceTollMeters>0?'road-or-country-reference':allExplicitlyFree?'verified':'section-road-average',
    roads: [...roads.values()].map(item => ({ ...item, euros: item.complete ? money(item.euros,item.referenceMeters) : null,
      pricingConfidence:!item.complete?'unavailable':item.exact?'exact':item.referenceMeters>0?'low':'standard',
      pricing: item.complete ? (item.exact ? 'exact' : 'estimate') : 'unavailable' })) };
}
