const EARTH_RADIUS_METERS = 6371008.8;
const CLUSTER_RADIUS_METERS = 550;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(N[Oº°]|NO|NÓ|NODE|EXIT|SAIDA|SAÍDA|LIGACAO|LIGAÇÃO)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  return new Set(
    normalize(value)
      .split(' ')
      .filter(token => token.length > 1)
  );
}

function tokenScore(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  return (2 * common) / (left.size + right.size);
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

function clusterRoadPoints(points, roadRef) {
  const target = roadKey(roadRef);
  const candidates = points.filter(point => {
    const kindOk = point.kind === 'motorway_junction' || point.kind === 'toll_booth';
    return kindOk && roadKey(point.roadRef) === target;
  });

  const clusters = [];
  for (const point of candidates) {
    let best = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = distanceMeters(point, cluster);
      if (distance <= CLUSTER_RADIUS_METERS && distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }

    if (!best) {
      clusters.push({
        lat: point.lat,
        lon: point.lon,
        points: [point],
        names: new Set([point.name].filter(Boolean))
      });
      continue;
    }

    best.points.push(point);
    if (point.name) best.names.add(point.name);
    best.lat = best.points.reduce((sum, item) => sum + item.lat, 0) / best.points.length;
    best.lon = best.points.reduce((sum, item) => sum + item.lon, 0) / best.points.length;
  }

  return clusters;
}

function principalOrder(clusters) {
  if (clusters.length < 2) return clusters.slice();

  const meanLat = clusters.reduce((sum, c) => sum + c.lat, 0) / clusters.length;
  const meanLon = clusters.reduce((sum, c) => sum + c.lon, 0) / clusters.length;
  const lonScale = Math.cos(radians(meanLat));

  let xx = 0;
  let xy = 0;
  let yy = 0;
  const vectors = clusters.map(cluster => {
    const x = (cluster.lon - meanLon) * lonScale;
    const y = cluster.lat - meanLat;
    xx += x * x;
    xy += x * y;
    yy += y * y;
    return { cluster, x, y };
  });

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);

  return vectors
    .map(item => ({
      ...item,
      projection: item.x * ax + item.y * ay
    }))
    .sort((a, b) => a.projection - b.projection)
    .map(item => item.cluster);
}

function labelScore(cluster, label) {
  let best = 0;
  for (const name of cluster.names) {
    best = Math.max(best, tokenScore(name, label));
  }
  return best;
}

function transitionScore(previous, current, expectedKm) {
  if (!Number.isFinite(expectedKm) || expectedKm <= 0) {
    return 0;
  }

  const observedKm = distanceMeters(previous, current) / 1000;
  if (observedKm < 0.15) return -2;

  const ratio = observedKm / expectedKm;
  const penalty = Math.abs(Math.log(Math.max(0.05, ratio)));
  return Math.max(-1.2, 0.48 - 0.42 * penalty);
}

function align(boundaries, sections, orderedClusters) {
  const n = boundaries.length;
  const m = orderedClusters.length;
  if (!n || m < n) return null;

  const dp = Array.from({ length: n }, () => Array(m).fill(-Infinity));
  const prev = Array.from({ length: n }, () => Array(m).fill(-1));

  for (let j = 0; j < m; ++j) {
    const text = labelScore(orderedClusters[j], boundaries[0]);
    dp[0][j] = text * 1.25 - j * 0.018;
  }

  for (let i = 1; i < n; ++i) {
    const expectedKm = sections[i - 1]?.km;
    for (let j = i; j < m; ++j) {
      const text = labelScore(orderedClusters[j], boundaries[i]);
      for (let k = i - 1; k < j; ++k) {
        if (!Number.isFinite(dp[i - 1][k])) continue;
        const skipped = j - k - 1;
        const score = dp[i - 1][k] +
          text * 1.25 +
          transitionScore(orderedClusters[k], orderedClusters[j], expectedKm) -
          skipped * 0.022;
        if (score > dp[i][j]) {
          dp[i][j] = score;
          prev[i][j] = k;
        }
      }
    }
  }

  let end = -1;
  let best = -Infinity;
  for (let j = n - 1; j < m; ++j) {
    if (dp[n - 1][j] > best) {
      best = dp[n - 1][j];
      end = j;
    }
  }
  if (end < 0) return null;

  const indexes = Array(n).fill(-1);
  let cursor = end;
  for (let i = n - 1; i >= 0; --i) {
    indexes[i] = cursor;
    cursor = prev[i][cursor];
  }

  const selected = indexes.map(index => orderedClusters[index]);
  const textScores = selected.map((cluster, index) => labelScore(cluster, boundaries[index]));
  const segmentScores = sections.map((section, index) =>
    transitionScore(selected[index], selected[index + 1], section.km)
  );

  return {
    score: best,
    averageScore: best / n,
    selected,
    textScores,
    segmentScores,
    reversed: false
  };
}

function compactCluster(cluster, score = null) {
  const bestPoint = cluster.points
    .slice()
    .sort((a, b) => {
      const aNamed = a.name ? 1 : 0;
      const bNamed = b.name ? 1 : 0;
      return bNamed - aNamed;
    })[0];

  return {
    osmId: bestPoint.osmId,
    lat: cluster.lat,
    lon: cluster.lon,
    name: [...cluster.names].join(' | '),
    ref: bestPoint.ref,
    roadRef: bestPoint.roadRef,
    operator: bestPoint.operator,
    kind: bestPoint.kind,
    pairedOsmIds: cluster.points.map(point => point.osmId),
    ...(Number.isFinite(score) ? { score: Math.round(score * 1000) / 1000 } : {})
  };
}

function contiguousChains(sections) {
  const chains = [];
  let current = [];

  for (const section of sections) {
    if (
      section.system !== 'closed-or-traditional' ||
      !Number.isFinite(section.km) ||
      normalize(section.from) === normalize(section.to)
    ) {
      if (current.length >= 2) chains.push(current);
      current = [];
      continue;
    }

    if (!current.length) {
      current = [section];
      continue;
    }

    const previous = current[current.length - 1];
    if (normalize(previous.to) === normalize(section.from)) {
      current.push(section);
    } else {
      if (current.length >= 2) chains.push(current);
      current = [section];
    }
  }

  if (current.length >= 2) chains.push(current);
  return chains;
}

export function buildSequenceMatches(points, allSections) {
  const byRoad = new Map();
  for (const section of allSections) {
    const key = roadKey(section.roadRef);
    if (!byRoad.has(key)) byRoad.set(key, []);
    byRoad.get(key).push(section);
  }

  const result = new Map();

  for (const roadSections of byRoad.values()) {
    const roadRef = roadSections[0]?.roadRef;
    const clusters = clusterRoadPoints(points, roadRef);
    if (clusters.length < 3) continue;

    const ordered = principalOrder(clusters);
    const chains = contiguousChains(roadSections);

    for (const chain of chains) {
      const boundaries = [chain[0].from, ...chain.map(section => section.to)];
      const forward = align(boundaries, chain, ordered);
      const reverseCandidate = align(boundaries, chain, ordered.slice().reverse());
      if (reverseCandidate) reverseCandidate.reversed = true;

      const chosen = !forward
        ? reverseCandidate
        : !reverseCandidate
          ? forward
          : forward.score >= reverseCandidate.score
            ? forward
            : reverseCandidate;

      if (!chosen || chosen.averageScore < 0.12) continue;

      chain.forEach((section, index) => {
        const distanceQuality = chosen.segmentScores[index];
        const endpointText = Math.max(
          chosen.textScores[index],
          chosen.textScores[index + 1]
        );

        // Require either a recognizable endpoint or a geometrically plausible
        // segment. This keeps sequence inference from silently fabricating
        // boundaries on roads whose OSM junction coverage is incomplete.
        if (endpointText < 0.12 && distanceQuality < 0.05) {
          return;
        }

        result.set(section.id, {
          status: 'matched',
          matchMethod: 'road-sequence',
          id: section.id,
          roadRef: section.roadRef,
          system: section.system,
          operator: section.operator,
          tariffs: section.tariffs,
          source: section.source,
          km: section.km,
          confidence: Math.round(
            Math.max(0, Math.min(1,
              0.42 + endpointText * 0.35 + Math.max(-0.4, distanceQuality) * 0.23
            )) * 1000
          ) / 1000,
          from: compactCluster(chosen.selected[index], chosen.textScores[index]),
          to: compactCluster(chosen.selected[index + 1], chosen.textScores[index + 1])
        });
      });
    }
  }

  return result;
}
