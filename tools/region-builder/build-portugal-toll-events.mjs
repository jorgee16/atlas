import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PORTUGAL_TOLL_DATASET_2026
} from '../../src/routing/data/portugal-tolls-2026.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const EARTH_RADIUS_METERS = 6371008.8;
const LOGICAL_BOUNDARY_RADIUS_METERS = 450;

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

function labelVariants(value) {
  const base = normalize(value);
  const withoutRoadRefs = base
    .replace(/\b(?:A|IP|IC)\s*\d+(?:\s*-\s*\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutRomanSuffix = withoutRoadRefs
    .replace(/\s+(?:I|II|III|IV|V)$/g, '')
    .trim();

  return [...new Set([
    base,
    withoutRoadRefs,
    withoutRomanSuffix
  ].filter(Boolean))];
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

function bestLabelScore(pointName, label) {
  let best = 0;
  for (const variant of labelVariants(label)) {
    best = Math.max(best, tokenScore(pointName, variant));
  }
  return best;
}

function roadRefs(value) {
  const normalized = String(value ?? '').toUpperCase();
  return new Set(
    normalized
      .split(/[;,/\s]+/)
      .map(item => item.trim())
      .filter(item => /^A\d+(?:-\d+)?$/.test(item) || /^IP\d+$/.test(item) || /^IC\d+$/.test(item))
  );
}

function sharesRoadRef(point, section) {
  const p = roadRefs(point.roadRef);
  const target = normalize(section.roadRef).replace(/\s+/g, '');
  if (!p.size) return null;
  return p.has(target);
}

function operatorScore(point, section) {
  if (!point.operator || !section.operator) return 0;
  return tokenScore(point.operator, section.operator);
}

function distanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = radians(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function candidateScore(point, label, section) {
  let score = bestLabelScore(point.name, label) * 0.72;
  const refMatch = sharesRoadRef(point, section);

  if (refMatch === true) score += 0.24;
  if (refMatch === false) score -= 0.55;

  score += operatorScore(point, section) * 0.06;

  if (point.kind === 'toll_booth' || point.kind === 'toll_gantry') {
    score += 0.03;
  }

  return score;
}

function roadScopedPoints(points, section, allowedKinds) {
  const kindPoints = points.filter(point => allowedKinds.has(point.kind));
  const exactRoad = kindPoints.filter(point => sharesRoadRef(point, section) === true);

  // When the PBF exposes motorway refs, never let a same-name junction on the
  // opposite side of the country compete. If OSM omitted the ref entirely,
  // retain those unreferenced candidates as a fallback.
  if (exactRoad.length) {
    return [
      ...exactRoad,
      ...kindPoints.filter(point => sharesRoadRef(point, section) === null)
    ];
  }

  return kindPoints.filter(point => sharesRoadRef(point, section) !== false);
}

function sameLogicalBoundary(left, right) {
  if (!left || !right) return false;
  if (distanceMeters(left.point, right.point) > LOGICAL_BOUNDARY_RADIUS_METERS) {
    return false;
  }

  const leftRef = normalize(left.point.roadRef);
  const rightRef = normalize(right.point.roadRef);
  if (leftRef && rightRef && leftRef !== rightRef) {
    return false;
  }

  // Motorways commonly have one junction/toll node per carriageway. Treat
  // those close parallel nodes as one boundary instead of an ambiguity.
  return true;
}

function bestBoundary(points, label, section, allowedKinds) {
  const candidates = roadScopedPoints(points, section, allowedKinds)
    .map(point => ({
      point,
      score: candidateScore(point, label, section)
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const duplicateCarriageway = sameLogicalBoundary(best, second);

  return {
    best,
    second,
    duplicateCarriageway,
    ambiguous: Boolean(
      best &&
      second &&
      !duplicateCarriageway &&
      best.score >= 0.48 &&
      second.score >= best.score - 0.04
    )
  };
}

function compactPoint(point, score) {
  return {
    osmId: point.osmId,
    lat: point.lat,
    lon: point.lon,
    name: point.name,
    ref: point.ref,
    roadRef: point.roadRef,
    operator: point.operator,
    kind: point.kind,
    score: Math.round(score * 1000) / 1000
  };
}

function compactBoundary(match) {
  if (!match.best) return null;
  const result = compactPoint(match.best.point, match.best.score);
  if (match.duplicateCarriageway && match.second) {
    result.pairedOsmIds = [
      match.best.point.osmId,
      match.second.point.osmId
    ];
  }
  return result;
}

function matchSection(points, section) {
  const physicalCharge =
    section.system === 'electronic-gantry' ||
    section.system === 'traditional-plaza' ||
    section.system === 'bridge-plaza';

  if (physicalCharge) {
    const label = section.name || section.from || section.to;
    const match = bestBoundary(
      points,
      label,
      section,
      new Set(['toll_booth', 'toll_gantry'])
    );

    if (!match.best || match.best.score < 0.46 || match.ambiguous) {
      return {
        status: match.ambiguous ? 'ambiguous' : 'unresolved',
        id: section.id,
        roadRef: section.roadRef,
        system: section.system,
        label,
        candidates: [match.best, match.second]
          .filter(Boolean)
          .map(item => compactPoint(item.point, item.score))
      };
    }

    return {
      status: 'matched',
      id: section.id,
      roadRef: section.roadRef,
      system: section.system,
      operator: section.operator,
      tariffs: section.tariffs,
      direction: section.direction ?? null,
      source: section.source,
      point: compactBoundary(match)
    };
  }

  const from = bestBoundary(
    points,
    section.from,
    section,
    new Set(['motorway_junction', 'toll_booth'])
  );
  const to = bestBoundary(
    points,
    section.to,
    section,
    new Set(['motorway_junction', 'toll_booth'])
  );

  const validFrom = from.best && from.best.score >= 0.46 && !from.ambiguous;
  const validTo = to.best && to.best.score >= 0.46 && !to.ambiguous;

  if (!validFrom || !validTo) {
    return {
      status: from.ambiguous || to.ambiguous ? 'ambiguous' : 'unresolved',
      id: section.id,
      roadRef: section.roadRef,
      system: section.system,
      from: section.from,
      to: section.to,
      fromCandidates: [from.best, from.second]
        .filter(Boolean)
        .map(item => compactPoint(item.point, item.score)),
      toCandidates: [to.best, to.second]
        .filter(Boolean)
        .map(item => compactPoint(item.point, item.score))
    };
  }

  if (
    from.best.point.osmId === to.best.point.osmId ||
    distanceMeters(from.best.point, to.best.point) < 100
  ) {
    return {
      status: 'ambiguous',
      id: section.id,
      roadRef: section.roadRef,
      system: section.system,
      reason: 'same-boundary',
      from: compactBoundary(from),
      to: compactBoundary(to)
    };
  }

  return {
    status: 'matched',
    id: section.id,
    roadRef: section.roadRef,
    system: section.system,
    operator: section.operator,
    tariffs: section.tariffs,
    source: section.source,
    km: section.km,
    from: compactBoundary(from),
    to: compactBoundary(to)
  };
}

export function buildPortugalTollEvents(pointsDocument) {
  const points = Array.isArray(pointsDocument?.points)
    ? pointsDocument.points
    : [];

  const matches = PORTUGAL_TOLL_DATASET_2026.sections.map(
    section => matchSection(points, section)
  );

  const matched = matches.filter(item => item.status === 'matched');
  const unresolved = matches.filter(item => item.status !== 'matched');

  return {
    version: 2,
    datasetVersion: PORTUGAL_TOLL_DATASET_2026.version,
    generatedAt: new Date().toISOString(),
    currency: PORTUGAL_TOLL_DATASET_2026.currency,
    matchedCount: matched.length,
    unresolvedCount: unresolved.length,
    zeroTollScopes: PORTUGAL_TOLL_DATASET_2026.zeroTollScopes,
    exemptions: PORTUGAL_TOLL_DATASET_2026.exemptions,
    events: matched,
    unresolved
  };
}

async function main() {
  const routingDir = path.resolve(
    process.argv[2] ?? path.join(repoRoot, 'build/portugal/routing')
  );

  const input = path.join(routingDir, 'toll-points.json');
  const output = path.join(routingDir, 'toll-events.json');
  const report = path.join(routingDir, 'toll-match-report.json');

  const pointsDocument = JSON.parse(
    await fs.readFile(input, 'utf8')
  );

  const result = buildPortugalTollEvents(pointsDocument);

  await fs.writeFile(output, JSON.stringify({
    version: result.version,
    datasetVersion: result.datasetVersion,
    generatedAt: result.generatedAt,
    currency: result.currency,
    zeroTollScopes: result.zeroTollScopes,
    exemptions: result.exemptions,
    events: result.events
  }, null, 2) + '\n');

  await fs.writeFile(report, JSON.stringify({
    matchedCount: result.matchedCount,
    unresolvedCount: result.unresolvedCount,
    unresolved: result.unresolved
  }, null, 2) + '\n');

  console.log(
    `Matched ${result.matchedCount} toll records; ${result.unresolvedCount} require review.`
  );
  console.log(`Wrote ${output}`);
  console.log(`Wrote ${report}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
