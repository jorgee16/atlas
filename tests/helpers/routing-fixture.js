const FORMAT_VERSION = 5;

function writeMagic(view, offset, magic) {
  [...magic].forEach((character, index) => {
    view.setUint8(
      offset + index,
      character.charCodeAt(0)
    );
  });
}

function createNodes(nodes) {
  const buffer = new ArrayBuffer(
    16 + nodes.length * 12
  );

  const view = new DataView(buffer);

  writeMagic(view, 0, 'RNOD');
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, nodes.length, true);
  view.setUint32(12, 12, true);

  nodes.forEach((node, index) => {
    const offset = 16 + index * 12;

    view.setFloat32(offset, node.lat, true);
    view.setFloat32(offset + 4, node.lon, true);
    view.setUint32(
      offset + 8,
      node.component ?? 0,
      true
    );
  });

  return buffer;
}

function prepareEdges(inputEdges) {
  return inputEdges.map(
    (edge, index) => ({
      ...edge,
      road: edge.road ?? 0,
      geometryArc:
        edge.geometryArc ?? index
    })
  ).sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to ||
      left.road - right.road
  );
}

function createEdges(nodes, edges) {
  const offsets =
    new Uint32Array(nodes.length + 1);

  edges.forEach(edge => {
    offsets[edge.from + 1] += 1;
  });

  for (
    let index = 1;
    index < offsets.length;
    index += 1
  ) {
    offsets[index] += offsets[index - 1];
  }

  const recordsOffset =
    20 + offsets.length * 4;

  const buffer = new ArrayBuffer(
    recordsOffset + edges.length * 20
  );

  const view = new DataView(buffer);

  writeMagic(view, 0, 'REDG');
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, nodes.length, true);
  view.setUint32(12, edges.length, true);
  view.setUint32(16, 20, true);

  offsets.forEach((offset, index) => {
    view.setUint32(
      20 + index * 4,
      offset,
      true
    );
  });

  edges.forEach((edge, index) => {
    const offset =
      recordsOffset + index * 20;

    view.setUint32(offset, edge.to, true);
    view.setUint32(
      offset + 4,
      edge.distanceDecimeters ?? 1_000,
      true
    );
    view.setUint32(
      offset + 8,
      edge.durationCentiseconds |
        ((edge.roadClass ?? 6) << 24) |
        (edge.oneWay ? 0x80000000 : 0),
      true
    );
    view.setUint32(
      offset + 12,
      edge.geometryArc |
        ((edge.driveAllowed ?? true) ? 0x20000000 : 0) |
        ((edge.walkAllowed ?? true) ? 0x40000000 : 0) |
        (
          edge.geometryReversed
            ? 0x80000000
            : 0
        ),
      true
    );
    view.setUint32(
      offset + 16,
      edge.road,
      true
    );
  });

  return buffer;
}

function createGeometry(inputEdges) {
  const arcCount = inputEdges.length;
  const arcs = inputEdges.map(
    edge => edge.geometry ?? []
  );

  const pointCount = arcs.reduce(
    (total, points) =>
      total + points.length,
    0
  );

  const pointsOffset =
    24 + arcCount * 8;

  const buffer = new ArrayBuffer(
    pointsOffset + pointCount * 8
  );

  const view = new DataView(buffer);

  writeMagic(view, 0, 'RGEO');
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, arcCount, true);
  view.setUint32(12, pointCount, true);
  view.setUint32(16, 8, true);
  view.setUint32(20, 8, true);

  let pointIndex = 0;

  arcs.forEach((points, arcIndex) => {
    const arcOffset = 24 + arcIndex * 8;

    view.setUint32(
      arcOffset,
      pointIndex,
      true
    );
    view.setUint32(
      arcOffset + 4,
      points.length,
      true
    );

    points.forEach(point => {
      const offset =
        pointsOffset + pointIndex * 8;

      view.setFloat32(offset, point.lat, true);
      view.setFloat32(offset + 4, point.lon, true);
      pointIndex += 1;
    });
  });

  return {
    buffer,
    arcCount,
    pointCount
  };
}

function createRoadAssets(roads) {
  const encoder = new TextEncoder();
  const stringOffsets = new Map([['', 0]]);
  const chunks = [new Uint8Array([0])];
  let stringBytes = 1;

  const intern = value => {
    const text = value ?? '';

    if (stringOffsets.has(text)) {
      return stringOffsets.get(text);
    }

    const bytes = encoder.encode(text);
    const offset = stringBytes;
    const terminated = new Uint8Array(
      bytes.length + 1
    );

    terminated.set(bytes);
    chunks.push(terminated);
    stringOffsets.set(text, offset);
    stringBytes += terminated.length;
    return offset;
  };

  const records = roads.map(road => ({
    name: intern(road.name),
    ref: intern(road.ref),
    destination: intern(road.destination),
    lanes: intern(road.lanes),
    turnLanes: intern(road.turnLanes),
    turnLanesForward: intern(road.turnLanesForward),
    turnLanesBackward: intern(road.turnLanesBackward),
    destinationLanes: intern(road.destinationLanes),
    flags:
      (road.roundabout ? 1 : 0) |
      (road.link ? 2 : 0)
  }));

  const roadBuffer = new ArrayBuffer(
    16 + records.length * 36
  );

  const roadView = new DataView(roadBuffer);
  writeMagic(roadView, 0, 'RROD');
  roadView.setUint32(4, FORMAT_VERSION, true);
  roadView.setUint32(8, records.length, true);
  roadView.setUint32(12, 36, true);

  records.forEach((road, index) => {
    const offset = 16 + index * 36;
    roadView.setUint32(offset, road.name, true);
    roadView.setUint32(offset + 4, road.ref, true);
    roadView.setUint32(
      offset + 8,
      road.destination,
      true
    );
    roadView.setUint32(offset + 12, road.lanes, true);
    roadView.setUint32(offset + 16, road.turnLanes, true);
    roadView.setUint32(offset + 20, road.turnLanesForward, true);
    roadView.setUint32(offset + 24, road.turnLanesBackward, true);
    roadView.setUint32(offset + 28, road.destinationLanes, true);
    roadView.setUint32(offset + 32, road.flags, true);
  });

  const stringBuffer = new ArrayBuffer(
    12 + stringBytes
  );

  const stringView = new DataView(stringBuffer);
  writeMagic(stringView, 0, 'RSTR');
  stringView.setUint32(4, FORMAT_VERSION, true);
  stringView.setUint32(8, stringBytes, true);

  const stringOutput = new Uint8Array(
    stringBuffer,
    12
  );

  let outputOffset = 0;

  chunks.forEach(chunk => {
    stringOutput.set(chunk, outputOffset);
    outputOffset += chunk.length;
  });

  return {
    roads: roadBuffer,
    strings: stringBuffer
  };
}

function createRestrictions(input) {
  const restrictions = [...input].sort(
    (left, right) =>
      left.viaNode - right.viaNode ||
      left.fromRoad - right.fromRoad ||
      left.toRoad - right.toRoad
  );

  const buffer = new ArrayBuffer(
    16 + restrictions.length * 16
  );

  const view = new DataView(buffer);
  writeMagic(view, 0, 'RTRN');
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, restrictions.length, true);
  view.setUint32(12, 16, true);

  restrictions.forEach((restriction, index) => {
    const offset = 16 + index * 16;
    view.setUint32(
      offset,
      restriction.viaNode,
      true
    );
    view.setUint32(
      offset + 4,
      restriction.fromRoad,
      true
    );
    view.setUint32(
      offset + 8,
      restriction.toRoad,
      true
    );
    view.setUint32(
      offset + 12,
      restriction.only ? 1 : 0,
      true
    );
  });

  return buffer;
}

function createSpatialIndex(
  nodes,
  cellSizeDegrees = 0.005
) {
  const entries = nodes.map((node, index) => ({
    x: Math.floor(node.lon / cellSizeDegrees),
    y: Math.floor(node.lat / cellSizeDegrees),
    node: index
  })).sort(
    (left, right) =>
      left.x - right.x ||
      left.y - right.y ||
      left.node - right.node
  );

  const cells = [];

  for (
    let index = 0;
    index < entries.length;
  ) {
    const start = index;
    const { x, y } = entries[index];

    while (
      index < entries.length &&
      entries[index].x === x &&
      entries[index].y === y
    ) {
      index += 1;
    }

    cells.push({
      x,
      y,
      offset: start,
      count: index - start
    });
  }

  const entriesOffset =
    24 + cells.length * 16;

  const buffer = new ArrayBuffer(
    entriesOffset + entries.length * 4
  );

  const view = new DataView(buffer);
  writeMagic(view, 0, 'RGRD');
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(
    8,
    Math.round(cellSizeDegrees * 1_000_000),
    true
  );
  view.setUint32(12, cells.length, true);
  view.setUint32(16, entries.length, true);
  view.setUint32(20, 16, true);

  cells.forEach((cell, index) => {
    const offset = 24 + index * 16;
    view.setInt32(offset, cell.x, true);
    view.setInt32(offset + 4, cell.y, true);
    view.setUint32(offset + 8, cell.offset, true);
    view.setUint32(offset + 12, cell.count, true);
  });

  entries.forEach((entry, index) => {
    view.setUint32(
      entriesOffset + index * 4,
      entry.node,
      true
    );
  });

  return buffer;
}

export function createRoutingBuffers({
  nodes,
  edges: inputEdges,
  roads: inputRoads = null,
  restrictions: inputRestrictions = [],
  cellSizeDegrees = 0.005
}) {
  const edges = prepareEdges(inputEdges);
  const geometry = createGeometry(inputEdges);

  const maximumRoad = edges.reduce(
    (maximum, edge) =>
      Math.max(maximum, edge.road),
    0
  );

  const roads = inputRoads ??
    Array.from(
      { length: maximumRoad + 1 },
      (_, index) => ({
        name: `Road ${index + 1}`,
        ref: '',
        destination: '',
        roundabout: false,
        link: false
      })
    );

  const roadAssets = createRoadAssets(roads);

  return {
    nodes: createNodes(nodes),
    edges: createEdges(nodes, edges),
    geometry: geometry.buffer,
    roads: roadAssets.roads,
    strings: roadAssets.strings,
    restrictions:
      createRestrictions(inputRestrictions),
    spatialIndex: createSpatialIndex(
      nodes,
      cellSizeDegrees
    ),
    metadata: {
      version: FORMAT_VERSION,
      profiles: ['drive', 'walk'],
      nodeCount: nodes.length,
      directedEdgeCount: edges.length,
      geometryArcCount: geometry.arcCount,
      geometryPointCount: geometry.pointCount,
      roadCount: roads.length,
      turnRestrictionCount:
        inputRestrictions.length
    }
  };
}
