const EARTH_RADIUS_METERS = 6371008.8;
const CLUSTER_RADIUS_METERS = 500;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function roadKey(value) {
  return normalize(value).replace(/\s+/g, '');
}

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(a, b) {
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = radians(b.lon - a.lon);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cluster(points) {
  const clusters = [];
  for (const point of points) {
    let found = null;
    for (const candidate of clusters) {
      if (distanceMeters(point, candidate) <= CLUSTER_RADIUS_METERS) {
        found = candidate;
        break;
      }
    }

    if (!found) {
      clusters.push({ lat: point.lat, lon: point.lon, points: [point] });
      continue;
    }

    found.points.push(point);
    found.lat = found.points.reduce((sum, item) => sum + item.lat, 0) / found.points.length;
    found.lon = found.points.reduce((sum, item) => sum + item.lon, 0) / found.points.length;
  }
  return clusters;
}

function principalOrder(clusters) {
  if (clusters.length < 2) return clusters.slice();

  const meanLat = clusters.reduce((sum, item) => sum + item.lat, 0) / clusters.length;
  const meanLon = clusters.reduce((sum, item) => sum + item.lon, 0) / clusters.length;
  const lonScale = Math.cos(radians(meanLat));

  let xx = 0;
  let xy = 0;
  let yy = 0;
  const vectors = clusters.map(item => {
    const x = (item.lon - meanLon) * lonScale;
    const y = item.lat - meanLat;
    xx += x * x;
    xy += x * y;
    yy += y * y;
    return { item, x, y };
  });

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);

  return vectors
    .map(entry => ({ ...entry, projection: entry.x * ax + entry.y * ay }))
    .sort((a, b) => a.projection - b.projection)
    .map(entry => entry.item);
}

function compactCluster(item) {
  const best = item.points.find(point => point.name) ?? item.points[0];
  return {
    osmId: best.osmId,
    lat: item.lat,
    lon: item.lon,
    name: item.points.map(point => point.name).filter(Boolean).join(' | '),
    ref: best.ref,
    roadRef: best.roadRef,
    operator: best.operator,
    kind: best.kind,
    pairedOsmIds: item.points.map(point => point.osmId)
  };
}

function orderedSections(sections) {
  return sections.slice().sort((a, b) => {
    const aId = String(a.id ?? '');
    const bId = String(b.id ?? '');
    return aId.localeCompare(bId, undefined, { numeric: true });
  });
}

function buildForRoad(points, sections) {
  const roadRef = sections[0]?.roadRef;
  const system = sections[0]?.system;
  const kind = system === 'electronic-gantry' ? 'toll_gantry' : 'toll_booth';
  const target = roadKey(roadRef);

  const roadPoints = points.filter(point =>
    point.kind === kind && roadKey(point.roadRef) === target
  );

  const clusters = principalOrder(cluster(roadPoints));
  if (!clusters.length) return new Map();

  const official = orderedSections(sections);

  // Physical toll systems expose one logical charge point per plaza/gantry,
  // often duplicated by carriageway. If counts line up after clustering, road
  // order is much safer than fuzzy names. Test both directions because the
  // principal axis has no inherent motorway direction.
  if (clusters.length !== official.length) {
    return new Map();
  }

  const forward = clusters;
  const reverse = clusters.slice().reverse();

  function nameAffinity(sequence) {
    let score = 0;
    for (let index = 0; index < official.length; ++index) {
      const label = normalize(official[index].name || official[index].from || official[index].to);
      const pointNames = normalize(sequence[index].points.map(point => point.name).join(' '));
      if (!label || !pointNames) continue;
      const labelTokens = new Set(label.split(' ').filter(Boolean));
      const pointTokens = new Set(pointNames.split(' ').filter(Boolean));
      for (const token of labelTokens) {
        if (token.length > 2 && pointTokens.has(token)) score += 1;
      }
    }
    return score;
  }

  const chosen = nameAffinity(reverse) > nameAffinity(forward) ? reverse : forward;
  const matches = new Map();

  official.forEach((section, index) => {
    matches.set(section.id, {
      status: 'matched',
      matchMethod: 'physical-road-order',
      id: section.id,
      roadRef: section.roadRef,
      system: section.system,
      operator: section.operator,
      tariffs: section.tariffs,
      direction: section.direction ?? null,
      source: section.source,
      point: compactCluster(chosen[index]),
      confidence: 0.82
    });
  });

  return matches;
}

export function buildPhysicalMatches(points, sections) {
  const supported = sections.filter(section =>
    section.system === 'electronic-gantry' ||
    section.system === 'traditional-plaza'
  );

  const groups = new Map();
  for (const section of supported) {
    const key = `${roadKey(section.roadRef)}:${section.system}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(section);
  }

  const result = new Map();
  for (const group of groups.values()) {
    for (const [id, match] of buildForRoad(points, group)) {
      result.set(id, match);
    }
  }
  return result;
}
