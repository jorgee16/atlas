import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_PHYSICAL_EDGE_DISTANCE_METERS = 120;

function roadKey(value) {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '').trim();
}

function motorwayRefs(value) {
  const matches = String(value ?? '')
    .toUpperCase()
    .match(/\bA\s*\d+(?:\s*-\s*\d+)?\b/g) ?? [];
  return new Set(matches.map(ref => roadKey(ref)));
}

function roadIdentityRefs(value) {
  const motorways = motorwayRefs(value);
  if (motorways.size) return motorways;

  const key = roadKey(value);
  return key ? new Set([key]) : new Set();
}

function refsOverlap(left, right) {
  if (!left.size || !right.size) return false;
  for (const ref of left) {
    if (right.has(ref)) return true;
  }
  return false;
}

function pointIds(point) {
  if (!point) return [];
  return [point.osmId, ...(Array.isArray(point.pairedOsmIds) ? point.pairedOsmIds : [])]
    .filter(value => value !== undefined && value !== null);
}

function closestPhysicalEdge(match) {
  const candidates = Array.isArray(match?.edges) ? match.edges : [];
  if (!candidates.length) return null;

  return candidates
    .filter(edge => Number.isFinite(edge.distanceMeters))
    .slice()
    .sort((a, b) =>
      a.distanceMeters - b.distanceMeters ||
      (a.networkMetersFromSnap ?? Infinity) - (b.networkMetersFromSnap ?? Infinity)
    )[0] ?? null;
}

function compactEdge(edge, match, point, role) {
  if (!edge) return null;
  return {
    role,
    partitionId: match.partitionId ?? edge.partitionId ?? null,
    edgeIndex: edge.edgeIndex,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
    roadIndex: edge.roadIndex,
    roadRef: edge.roadRef ?? '',
    inferredRoadRef: point.inferredRoadRef ?? match.inferredRoadRef ?? '',
    roadName: edge.roadName ?? '',
    distanceMeters: edge.distanceMeters ?? null,
    networkMetersFromSnap: edge.networkMetersFromSnap ?? null,
    source: match.inferredRoadRefSource ?? null,
    osmTollTagged: Boolean(edge.osmTollTagged),
    electronicTollTagged: Boolean(edge.electronicTollTagged)
  };
}

function routingEvidenceForPoint(point) {
  const match = point?.routingMatch;
  if (!match) return null;

  const physicalEdge = closestPhysicalEdge(match);
  const identityEdge = match.inferredEdge ?? null;
  if (!physicalEdge && !identityEdge) return null;

  return {
    physicalEdge: compactEdge(physicalEdge, match, point, 'physical-crossing'),
    identityEdge: compactEdge(identityEdge, match, point, 'road-identity')
  };
}

function evidenceForEvent(event, byOsmId) {
  const eventPoints = [event.point, event.from, event.to].filter(Boolean);
  const physicalEdges = [];
  const identityEdges = [];
  const seenPhysical = new Set();
  const seenIdentity = new Set();

  for (const eventPoint of eventPoints) {
    for (const osmId of pointIds(eventPoint)) {
      const evidence = routingEvidenceForPoint(byOsmId.get(String(osmId)));
      if (!evidence) continue;

      if (evidence.physicalEdge) {
        const key = `${evidence.physicalEdge.partitionId}:${evidence.physicalEdge.edgeIndex}`;
        if (!seenPhysical.has(key)) {
          seenPhysical.add(key);
          physicalEdges.push(evidence.physicalEdge);
        }
      }

      if (evidence.identityEdge) {
        const key = `${evidence.identityEdge.partitionId}:${evidence.identityEdge.edgeIndex}`;
        if (!seenIdentity.has(key)) {
          seenIdentity.add(key);
          identityEdges.push(evidence.identityEdge);
        }
      }
    }
  }

  return { physicalEdges, identityEdges };
}

function evidenceRoadRefs(edge) {
  const inferred = roadIdentityRefs(edge.inferredRoadRef);
  if (inferred.size) return inferred;
  return roadIdentityRefs(edge.roadRef);
}

async function main() {
  const routingDir = path.resolve(process.argv[2] ?? 'build/portugal/routing');
  const eventsDocument = JSON.parse(await fs.readFile(path.join(routingDir, 'toll-events.json'), 'utf8'));
  const routedDocument = JSON.parse(await fs.readFile(path.join(routingDir, 'toll-points-routed.json'), 'utf8'));
  const byOsmId = new Map((routedDocument.points ?? []).map(point => [String(point.osmId), point]));

  const audit = {
    eventCount: eventsDocument.events?.length ?? 0,
    eventsWithRoutingEvidence: 0,
    physicalEvents: 0,
    physicalEventsWithRoutingEvidence: 0,
    physicalRoadAgreement: 0,
    physicalRoadConflict: 0,
    physicalWithoutEvidence: [],
    physicalConflicts: [],
    physicalEventsWithSafeCrossingEdge: 0,
    physicalEventsWithDistantCrossingEdge: 0,
    distantPhysicalCrossings: []
  };

  const events = (eventsDocument.events ?? []).map(event => {
    const { physicalEdges, identityEdges } = evidenceForEvent(event, byOsmId);
    const hasEvidence = physicalEdges.length || identityEdges.length;
    const physical = ['electronic-gantry', 'traditional-plaza', 'bridge-plaza'].includes(event.system);

    if (hasEvidence) audit.eventsWithRoutingEvidence += 1;

    if (physical) {
      audit.physicalEvents += 1;

      if (hasEvidence) {
        audit.physicalEventsWithRoutingEvidence += 1;

        const expected = roadIdentityRefs(event.roadRef);
        const roadEvidence = identityEdges.length ? identityEdges : physicalEdges;
        const agrees = !expected.size || roadEvidence.some(edge =>
          refsOverlap(expected, evidenceRoadRefs(edge))
        );

        if (agrees) audit.physicalRoadAgreement += 1;
        else {
          audit.physicalRoadConflict += 1;
          audit.physicalConflicts.push({
            id:event.id,
            expectedRoadRef:event.roadRef,
            inferredRoadRefs:[...new Set(roadEvidence.flatMap(edge => [...evidenceRoadRefs(edge)]))],
            identityEdges: roadEvidence
          });
        }

        const safeCrossings = physicalEdges.filter(edge =>
          Number.isFinite(edge.distanceMeters) &&
          edge.distanceMeters <= MAX_PHYSICAL_EDGE_DISTANCE_METERS
        );

        if (safeCrossings.length) {
          audit.physicalEventsWithSafeCrossingEdge += 1;
        } else {
          audit.physicalEventsWithDistantCrossingEdge += 1;
          audit.distantPhysicalCrossings.push({
            id: event.id,
            roadRef: event.roadRef,
            physicalEdges
          });
        }
      } else {
        audit.physicalWithoutEvidence.push({id:event.id, roadRef:event.roadRef, system:event.system, matchMethod:event.matchMethod});
      }
    }

    return hasEvidence
      ? {...event, routingEdges: physicalEdges, routingIdentityEdges: identityEdges}
      : event;
  });

  const outputPath = path.join(routingDir, 'toll-events-routed.json');
  const auditPath = path.join(routingDir, 'toll-events-routing-audit.json');
  await fs.writeFile(outputPath, JSON.stringify({...eventsDocument, version:7, events}, null, 2) + '\n');
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2) + '\n');

  console.log({
    eventCount:audit.eventCount,
    eventsWithRoutingEvidence:audit.eventsWithRoutingEvidence,
    physicalEvents:audit.physicalEvents,
    physicalEventsWithRoutingEvidence:audit.physicalEventsWithRoutingEvidence,
    physicalRoadAgreement:audit.physicalRoadAgreement,
    physicalRoadConflict:audit.physicalRoadConflict,
    physicalWithoutEvidence:audit.physicalWithoutEvidence.length,
    physicalEventsWithSafeCrossingEdge:audit.physicalEventsWithSafeCrossingEdge,
    physicalEventsWithDistantCrossingEdge:audit.physicalEventsWithDistantCrossingEdge
  });
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${auditPath}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
