import fs from 'node:fs/promises';
import path from 'node:path';

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

function compactRoutingEvidence(point) {
  const match = point?.routingMatch;
  if (!match) return null;
  const edge = match.inferredEdge ?? match.edges?.[0] ?? null;
  if (!edge) return null;
  return {
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

function evidenceForEvent(event, byOsmId) {
  const eventPoints = [event.point, event.from, event.to].filter(Boolean);
  const evidence = [];
  const seen = new Set();
  for (const eventPoint of eventPoints) {
    for (const osmId of pointIds(eventPoint)) {
      const compact = compactRoutingEvidence(byOsmId.get(String(osmId)));
      if (!compact) continue;
      const key = `${compact.partitionId}:${compact.edgeIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(compact);
    }
  }
  return evidence;
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
    physicalConflicts: []
  };

  const events = (eventsDocument.events ?? []).map(event => {
    const routingEdges = evidenceForEvent(event, byOsmId);
    const physical = ['electronic-gantry', 'traditional-plaza', 'bridge-plaza'].includes(event.system);
    if (routingEdges.length) audit.eventsWithRoutingEvidence += 1;
    if (physical) {
      audit.physicalEvents += 1;
      if (routingEdges.length) {
        audit.physicalEventsWithRoutingEvidence += 1;
        const expected = roadIdentityRefs(event.roadRef);
        const agrees = !expected.size || routingEdges.some(edge =>
          refsOverlap(expected, evidenceRoadRefs(edge))
        );

        if (agrees) audit.physicalRoadAgreement += 1;
        else {
          audit.physicalRoadConflict += 1;
          audit.physicalConflicts.push({
            id:event.id,
            expectedRoadRef:event.roadRef,
            inferredRoadRefs:[...new Set(routingEdges.flatMap(edge => [...evidenceRoadRefs(edge)]))],
            routingEdges
          });
        }
      } else {
        audit.physicalWithoutEvidence.push({id:event.id, roadRef:event.roadRef, system:event.system, matchMethod:event.matchMethod});
      }
    }
    return routingEdges.length ? {...event, routingEdges} : event;
  });

  const outputPath = path.join(routingDir, 'toll-events-routed.json');
  const auditPath = path.join(routingDir, 'toll-events-routing-audit.json');
  await fs.writeFile(outputPath, JSON.stringify({...eventsDocument, version:6, events}, null, 2) + '\n');
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2) + '\n');

  console.log({
    eventCount:audit.eventCount,
    eventsWithRoutingEvidence:audit.eventsWithRoutingEvidence,
    physicalEvents:audit.physicalEvents,
    physicalEventsWithRoutingEvidence:audit.physicalEventsWithRoutingEvidence,
    physicalRoadAgreement:audit.physicalRoadAgreement,
    physicalRoadConflict:audit.physicalRoadConflict,
    physicalWithoutEvidence:audit.physicalWithoutEvidence.length
  });
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${auditPath}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
