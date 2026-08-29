import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPortugalTollEvents } from './build-portugal-toll-events.mjs';

function normalizePhysicalRoadRefs(document) {
  return {
    ...document,
    points: (document.points ?? []).map(point => {
      if (
        (point.kind !== 'toll_booth' && point.kind !== 'toll_gantry') ||
        !point.inferredRoadRef
      ) {
        return point;
      }

      return {
        ...point,
        originalRoadRef: point.roadRef ?? '',
        roadRef: point.inferredRoadRef,
        routingEvidence: point.routingMatch
          ? {
              partitionId: point.routingMatch.partitionId ?? null,
              inferredRoadRefSource:
                point.routingMatch.inferredRoadRefSource ?? null,
              inferredEdge: point.routingMatch.inferredEdge ?? null
            }
          : null
      };
    })
  };
}

async function main() {
  const routingDir = path.resolve(
    process.argv[2] ?? 'build/portugal/routing'
  );

  const routedInput = path.join(
    routingDir,
    'toll-points-routed.json'
  );

  const output = path.join(
    routingDir,
    'toll-events.json'
  );

  const report = path.join(
    routingDir,
    'toll-match-report.json'
  );

  const routedDocument = JSON.parse(
    await fs.readFile(routedInput, 'utf8')
  );

  const pointsDocument = normalizePhysicalRoadRefs(
    routedDocument
  );

  const result = buildPortugalTollEvents(
    pointsDocument
  );

  await fs.writeFile(
    output,
    JSON.stringify({
      version: result.version,
      datasetVersion: result.datasetVersion,
      generatedAt: result.generatedAt,
      currency: result.currency,
      zeroTollScopes: result.zeroTollScopes,
      exemptions: result.exemptions,
      events: result.events
    }, null, 2) + '\n'
  );

  await fs.writeFile(
    report,
    JSON.stringify({
      matchedCount: result.matchedCount,
      unresolvedCount: result.unresolvedCount,
      input: 'toll-points-routed.json',
      unresolved: result.unresolved
    }, null, 2) + '\n'
  );

  const methods = {};
  for (const event of result.events) {
    methods[event.matchMethod] =
      (methods[event.matchMethod] ?? 0) + 1;
  }

  console.log(
    `Matched ${result.matchedCount} toll records; ` +
    `${result.unresolvedCount} require review.`
  );
  console.log(methods);
  console.log(`Wrote ${output}`);
  console.log(`Wrote ${report}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
