import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_PHYSICAL_EDGE_DISTANCE_METERS = 120;
const PHYSICAL_SYSTEMS = new Set([
  'electronic-gantry',
  'traditional-plaza',
  'bridge-plaza'
]);

function safeEdges(event) {
  if (!PHYSICAL_SYSTEMS.has(event.system)) return [];
  return (event.routingEdges ?? []).filter(edge =>
    Number.isInteger(edge.edgeIndex) &&
    edge.edgeIndex >= 0 &&
    Number.isFinite(edge.distanceMeters) &&
    edge.distanceMeters <= MAX_PHYSICAL_EDGE_DISTANCE_METERS &&
    edge.partitionId
  );
}

function compactEvent(event) {
  return {
    id: event.id,
    roadRef: event.roadRef,
    system: event.system,
    operator: event.operator ?? null,
    tariffs: event.tariffs ?? {},
    direction: event.direction ?? null,
    source: event.source ?? null,
    matchMethod: event.matchMethod ?? null
  };
}

async function main() {
  const routingDir = path.resolve(
    process.argv[2] ?? 'build/portugal/routing'
  );

  const inputPath = path.join(
    routingDir,
    'toll-events-routed.json'
  );

  const document = JSON.parse(
    await fs.readFile(inputPath, 'utf8')
  );

  const partitions = new Map();
  const rejected = [];

  for (const event of document.events ?? []) {
    if (!PHYSICAL_SYSTEMS.has(event.system)) continue;

    const edges = safeEdges(event);
    if (!edges.length) {
      rejected.push({
        id: event.id,
        roadRef: event.roadRef,
        reason: 'no-safe-physical-crossing-edge'
      });
      continue;
    }

    for (const edge of edges) {
      if (!partitions.has(edge.partitionId)) {
        partitions.set(edge.partitionId, new Map());
      }

      const byEdge = partitions.get(edge.partitionId);
      if (!byEdge.has(edge.edgeIndex)) {
        byEdge.set(edge.edgeIndex, []);
      }

      byEdge.get(edge.edgeIndex).push({
        ...compactEvent(event),
        edgeIndex: edge.edgeIndex,
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        roadIndex: edge.roadIndex,
        crossingDistanceMeters: edge.distanceMeters
      });
    }
  }

  const report = {
    version: 1,
    datasetVersion: document.datasetVersion ?? null,
    generatedAt: new Date().toISOString(),
    partitionCount: partitions.size,
    physicalEventCount: (document.events ?? [])
      .filter(event => PHYSICAL_SYSTEMS.has(event.system)).length,
    rejected,
    partitions: {}
  };

  for (const [partitionId, byEdge] of partitions) {
    const events = [...byEdge.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([edgeIndex, edgeEvents]) => ({
        edgeIndex,
        events: edgeEvents
      }));

    const eventIds = new Set(
      events.flatMap(entry => entry.events.map(event => event.id))
    );

    const asset = {
      version: 1,
      datasetVersion: document.datasetVersion ?? null,
      partitionId,
      edgeCount: events.length,
      eventCount: eventIds.size,
      edges: events
    };

    const outputPath = path.join(
      routingDir,
      partitionId,
      'toll-events.json'
    );

    await fs.writeFile(
      outputPath,
      JSON.stringify(asset, null, 2) + '\n'
    );

    report.partitions[partitionId] = {
      edgeCount: asset.edgeCount,
      eventCount: asset.eventCount,
      output: path.relative(routingDir, outputPath)
    };

    console.log(
      `${partitionId}: ${asset.eventCount} physical toll events on ` +
      `${asset.edgeCount} directed crossing edges.`
    );
  }

  const reportPath = path.join(
    routingDir,
    'partition-toll-assets-report.json'
  );

  await fs.writeFile(
    reportPath,
    JSON.stringify(report, null, 2) + '\n'
  );

  console.log(`Rejected ${rejected.length} physical events.`);
  console.log(`Wrote ${reportPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
