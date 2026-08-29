const EARTH_RADIUS_METERS = 6371008.8;
const CLUSTER_RADIUS_METERS = 500;
const CORRIDOR_MAX_DISTANCE_METERS = 1800;
const CORRIDOR_WIN_RATIO = 0.68;

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

function isMotorwayRoadKey(value) {
  return /^A\d+(?:-\d+)?$/.test(roadKey(value));
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
    inferredRoadRef: best.inferredRoadRef ?? null,
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

function tokenSet(value) {
  return new Set(
    normalize(value)
      .split(' ')
      .filter(token => token.length > 2)
  );
}

function labelFor(section) {
  return section.name || section.from || section.to || '';
}

function clusterText(item) {
  return item.points
    .map(point => `${point.name ?? ''} ${point.ref ?? ''} ${point.operator ?? ''}`)
    .join(' ');
}

function affinity(section, item) {
  const expected = tokenSet(labelFor(section));
  const observed = tokenSet(clusterText(item));
  if (!expected.size || !observed.size) return 0;

  let common = 0;
  for (const token of expected) {
    if (observed.has(token)) common += 1;
  }

  return common / expected.size;
}

function operatorAffinity(section, item) {
  const expected = tokenSet(section.operator);
  const observed = tokenSet(
    item.points.map(point => point.operator ?? '').join(' ')
  );
  if (!expected.size || !observed.size) return 0;

  let common = 0;
  for (const token of expected) {
    if (observed.has(token)) common += 1;
  }
  return common / expected.size;
}

function localXY(point, originLat) {
  const latScale = Math.PI * EARTH_RADIUS_METERS / 180;
  const lonScale = latScale * Math.cos(radians(originLat));
  return {
    x: point.lon * lonScale,
    y: point.lat * latScale
  };
}

function pointSegmentDistanceMeters(point, a, b) {
  const originLat = (point.lat + a.lat + b.lat) / 3;
  const p = localXY(point, originLat);
  const aa = localXY(a, originLat);
  const bb = localXY(b, originLat);
  const dx = bb.x - aa.x;
  const dy = bb.y - aa.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1) {
    return Math.hypot(p.x - aa.x, p.y - aa.y);
  }
  const t = Math.max(0, Math.min(1,
    ((p.x - aa.x) * dx + (p.y - aa.y) * dy) / lengthSquared
  ));
  const x = aa.x + t * dx;
  const y = aa.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function corridorDistanceMeters(point, corridor) {
  if (!corridor.length) return Infinity;
  if (corridor.length === 1) return distanceMeters(point, corridor[0]);

  let best = Infinity;
  for (let index = 1; index < corridor.length; ++index) {
    best = Math.min(
      best,
      pointSegmentDistanceMeters(point, corridor[index - 1], corridor[index])
    );
  }
  return best;
}

function buildMotorwayCorridors(points) {
  const groups = new Map();
  for (const point of points) {
    if (point.kind !== 'motorway_junction' || !isMotorwayRoadKey(point.roadRef)) {
      continue;
    }
    const key = roadKey(point.roadRef);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }

  const corridors = new Map();
  for (const [key, roadPoints] of groups) {
    const ordered = principalOrder(cluster(roadPoints));
    if (ordered.length >= 2) corridors.set(key, ordered);
  }
  return corridors;
}

function physicalPointsForRoad(points, target, kind, corridors) {
  const exact = [];
  const inferred = [];

  for (const point of points) {
    if (point.kind !== kind) continue;

    if (roadKey(point.roadRef) === target) {
      exact.push(point);
      continue;
    }

    const targetCorridor = corridors.get(target);
    if (!targetCorridor) continue;

    const targetDistance = corridorDistanceMeters(point, targetCorridor);
    if (targetDistance > CORRIDOR_MAX_DISTANCE_METERS) continue;

    let competingDistance = Infinity;
    for (const [road, corridor] of corridors) {
      if (road === target) continue;
      competingDistance = Math.min(
        competingDistance,
        corridorDistanceMeters(point, corridor)
      );
    }

    const winsClearly = !Number.isFinite(competingDistance) ||
      targetDistance <= competingDistance * CORRIDOR_WIN_RATIO;

    if (!winsClearly) continue;

    inferred.push({
      ...point,
      inferredRoadRef: target
    });
  }

  return [...exact, ...inferred];
}

function alignOrderedSubsequence(official, orderedClusters) {
  const n = official.length;
  const m = orderedClusters.length;
  if (!n || m < n) return null;

  const dp = Array.from({ length: n }, () => Array(m).fill(-Infinity));
  const previous = Array.from({ length: n }, () => Array(m).fill(-1));

  for (let j = 0; j < m; ++j) {
    dp[0][j] = affinity(official[0], orderedClusters[j]) * 1.4 +
      operatorAffinity(official[0], orderedClusters[j]) * 0.25 -
      j * 0.045;
  }

  for (let i = 1; i < n; ++i) {
    for (let j = i; j < m; ++j) {
      const local = affinity(official[i], orderedClusters[j]) * 1.4 +
        operatorAffinity(official[i], orderedClusters[j]) * 0.25;

      for (let k = i - 1; k < j; ++k) {
        if (!Number.isFinite(dp[i - 1][k])) continue;
        const skipped = j - k - 1;
        const separationMeters = distanceMeters(
          orderedClusters[k],
          orderedClusters[j]
        );
        if (separationMeters < 120) continue;

        const score = dp[i - 1][k] + local - skipped * 0.055;
        if (score > dp[i][j]) {
          dp[i][j] = score;
          previous[i][j] = k;
        }
      }
    }
  }

  let end = -1;
  let score = -Infinity;
  for (let j = n - 1; j < m; ++j) {
    if (dp[n - 1][j] > score) {
      score = dp[n - 1][j];
      end = j;
    }
  }
  if (end < 0) return null;

  const indexes = Array(n).fill(-1);
  let cursor = end;
  for (let i = n - 1; i >= 0; --i) {
    indexes[i] = cursor;
    cursor = previous[i][cursor];
  }

  const selected = indexes.map(index => orderedClusters[index]);
  const affinities = selected.map((item, index) => affinity(official[index], item));
  const anchors = affinities.filter(value => value >= 0.34).length;
  const average = score / n;

  return {
    score,
    average,
    selected,
    affinities,
    anchors
  };
}

function chooseAlignment(official, clusters) {
  const forward = alignOrderedSubsequence(official, clusters);
  const reverse = alignOrderedSubsequence(official, clusters.slice().reverse());

  if (!forward) return reverse;
  if (!reverse) return forward;
  return forward.score >= reverse.score ? forward : reverse;
}

function buildForRoad(points, sections, corridors) {
  const roadRef = sections[0]?.roadRef;
  const system = sections[0]?.system;
  const kind = system === 'electronic-gantry' ? 'toll_gantry' : 'toll_booth';
  const target = roadKey(roadRef);

  const roadPoints = physicalPointsForRoad(points, target, kind, corridors);
  const clusters = principalOrder(cluster(roadPoints));
  if (!clusters.length) return new Map();

  const official = orderedSections(sections);
  if (clusters.length < official.length) return new Map();

  const alignment = chooseAlignment(official, clusters);
  if (!alignment) return new Map();

  const requiredAnchors = official.length <= 3 ? 1 : 2;
  const operatorAnchors = alignment.selected.filter((item, index) =>
    operatorAffinity(official[index], item) >= 0.5
  ).length;

  const inferredAnchors = alignment.selected.filter(item =>
    item.points.some(point => point.inferredRoadRef === target)
  ).length;

  if (
    alignment.anchors < requiredAnchors &&
    operatorAnchors < Math.max(2, Math.ceil(official.length / 2)) &&
    inferredAnchors < Math.max(2, Math.ceil(official.length / 2))
  ) {
    return new Map();
  }

  if (alignment.average < 0.05 && inferredAnchors < official.length) {
    return new Map();
  }

  const matches = new Map();
  official.forEach((section, index) => {
    const labelConfidence = alignment.affinities[index];
    const operatorConfidence = operatorAffinity(section, alignment.selected[index]);
    const wasInferred = alignment.selected[index].points.some(
      point => point.inferredRoadRef === target
    );
    const confidence = Math.max(
      0.60,
      Math.min(0.93,
        0.65 + labelConfidence * 0.18 + operatorConfidence * 0.08 + (wasInferred ? 0.04 : 0)
      )
    );

    matches.set(section.id, {
      status: 'matched',
      matchMethod: wasInferred
        ? 'physical-corridor-inference'
        : clusters.length === official.length
          ? 'physical-road-order'
          : 'physical-road-subsequence',
      id: section.id,
      roadRef: section.roadRef,
      system: section.system,
      operator: section.operator,
      tariffs: section.tariffs,
      direction: section.direction ?? null,
      source: section.source,
      point: compactCluster(alignment.selected[index]),
      confidence: Math.round(confidence * 1000) / 1000
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

  const corridors = buildMotorwayCorridors(points);
  const result = new Map();
  for (const group of groups.values()) {
    for (const [id, match] of buildForRoad(points, group, corridors)) {
      result.set(id, match);
    }
  }
  return result;
}
