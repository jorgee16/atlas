import {
  distanceMeters
} from '../features/navigation/navigation-geometry.js';

const NODE_HEADER_BYTES = 16;
const EDGE_HEADER_BYTES = 20;
const GEOMETRY_HEADER_BYTES = 24;
const ROAD_HEADER_BYTES = 16;
const STRING_HEADER_BYTES = 12;
const RESTRICTION_HEADER_BYTES = 16;
const GRID_HEADER_BYTES = 24;
const FORMAT_VERSION = 6;

function createView(buffer, label) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError(
      `${label} must be an ArrayBuffer.`
    );
  }

  return new DataView(buffer);
}

function readMagic(view) {
  return String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
}

function requireAsset({
  view,
  label,
  magic,
  minimumBytes
}) {
  if (view.byteLength < minimumBytes) {
    throw new Error(
      `${label} is truncated.`
    );
  }

  if (readMagic(view) !== magic) {
    throw new Error(
      `${label} has an invalid signature.`
    );
  }

  if (
    view.getUint32(4, true) !==
    FORMAT_VERSION
  ) {
    throw new Error(
      `${label} uses an unsupported routing format.`
    );
  }
}

function requireLength(
  view,
  expectedBytes,
  label
) {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    view.byteLength !== expectedBytes
  ) {
    throw new Error(
      `${label} has an invalid length.`
    );
  }
}

export class RoutingGraph {
  constructor({
    nodes,
    edges,
    geometry,
    roads,
    strings,
    restrictions,
    spatialIndex,
    metadata = null
  }) {
    this.nodeView = createView(
      nodes,
      'Routing nodes'
    );

    this.edgeView = createView(
      edges,
      'Routing edges'
    );

    this.geometryView = createView(
      geometry,
      'Routing geometry'
    );

    this.roadView = createView(
      roads,
      'Routing roads'
    );

    this.stringView = createView(
      strings,
      'Routing strings'
    );

    this.restrictionView = createView(
      restrictions,
      'Routing turn restrictions'
    );

    this.gridView = createView(
      spatialIndex,
      'Routing spatial index'
    );

    requireAsset({
      view: this.nodeView,
      label: 'Routing nodes',
      magic: 'RNOD',
      minimumBytes: NODE_HEADER_BYTES
    });

    requireAsset({
      view: this.edgeView,
      label: 'Routing edges',
      magic: 'REDG',
      minimumBytes: EDGE_HEADER_BYTES
    });

    requireAsset({
      view: this.geometryView,
      label: 'Routing geometry',
      magic: 'RGEO',
      minimumBytes: GEOMETRY_HEADER_BYTES
    });

    requireAsset({
      view: this.roadView,
      label: 'Routing roads',
      magic: 'RROD',
      minimumBytes: ROAD_HEADER_BYTES
    });

    requireAsset({
      view: this.stringView,
      label: 'Routing strings',
      magic: 'RSTR',
      minimumBytes: STRING_HEADER_BYTES
    });

    requireAsset({
      view: this.restrictionView,
      label: 'Routing turn restrictions',
      magic: 'RTRN',
      minimumBytes: RESTRICTION_HEADER_BYTES
    });

    requireAsset({
      view: this.gridView,
      label: 'Routing spatial index',
      magic: 'RGRD',
      minimumBytes: GRID_HEADER_BYTES
    });

    this.nodeCount =
      this.nodeView.getUint32(8, true);

    this.nodeRecordBytes =
      this.nodeView.getUint32(12, true);

    if (this.nodeRecordBytes !== 12) {
      throw new Error(
        'Routing nodes use an unsupported record size.'
      );
    }

    requireLength(
      this.nodeView,
      NODE_HEADER_BYTES +
        this.nodeCount *
          this.nodeRecordBytes,
      'Routing nodes'
    );

    const edgeNodeCount =
      this.edgeView.getUint32(8, true);

    this.edgeCount =
      this.edgeView.getUint32(12, true);

    this.edgeRecordBytes =
      this.edgeView.getUint32(16, true);

    if (
      edgeNodeCount !== this.nodeCount ||
      this.edgeRecordBytes !== 20
    ) {
      throw new Error(
        'Routing edge metadata does not match the node graph.'
      );
    }

    this.edgeOffsetsByteOffset =
      EDGE_HEADER_BYTES;

    this.edgeRecordsByteOffset =
      this.edgeOffsetsByteOffset +
      (this.nodeCount + 1) * 4;

    requireLength(
      this.edgeView,
      this.edgeRecordsByteOffset +
        this.edgeCount *
          this.edgeRecordBytes,
      'Routing edges'
    );

    if (
      this.edgeOffset(this.nodeCount) !==
      this.edgeCount
    ) {
      throw new Error(
        'Routing edge offsets are inconsistent.'
      );
    }

    this.driveNodeMask =
      new Uint8Array(this.nodeCount);

    this.walkNodeMask =
      new Uint8Array(this.nodeCount);

    for (let node = 0; node < this.nodeCount; node += 1) {
      for (
        let edgeIndex = this.edgeOffset(node);
        edgeIndex < this.edgeOffset(node + 1);
        edgeIndex += 1
      ) {
        const target = this.edgeTarget(edgeIndex);
        const metadata = this.#edgeValue(edgeIndex, 12);

        if (metadata & 0x20000000) {
          this.driveNodeMask[node] = 1;
          this.driveNodeMask[target] = 1;
        }

        if (metadata & 0x40000000) {
          this.walkNodeMask[node] = 1;
          this.walkNodeMask[target] = 1;
        }
      }
    }

    this.geometryArcCount =
      this.geometryView.getUint32(8, true);

    this.geometryPointCount =
      this.geometryView.getUint32(12, true);

    this.geometryArcRecordBytes =
      this.geometryView.getUint32(16, true);

    this.geometryPointRecordBytes =
      this.geometryView.getUint32(20, true);

    if (
      this.geometryArcRecordBytes !== 8 ||
      this.geometryPointRecordBytes !== 8
    ) {
      throw new Error(
        'Routing geometry uses an unsupported record size.'
      );
    }

    this.geometryArcsByteOffset =
      GEOMETRY_HEADER_BYTES;

    this.geometryPointsByteOffset =
      this.geometryArcsByteOffset +
      this.geometryArcCount *
        this.geometryArcRecordBytes;

    requireLength(
      this.geometryView,
      this.geometryPointsByteOffset +
        this.geometryPointCount *
          this.geometryPointRecordBytes,
      'Routing geometry'
    );

    this.roadCount =
      this.roadView.getUint32(8, true);

    this.roadRecordBytes =
      this.roadView.getUint32(12, true);

    if (this.roadRecordBytes !== 36) {
      throw new Error(
        'Routing roads use an unsupported record size.'
      );
    }

    requireLength(
      this.roadView,
      ROAD_HEADER_BYTES +
        this.roadCount *
          this.roadRecordBytes,
      'Routing roads'
    );

    this.stringBytes =
      this.stringView.getUint32(8, true);

    requireLength(
      this.stringView,
      STRING_HEADER_BYTES +
        this.stringBytes,
      'Routing strings'
    );

    this.stringDecoder =
      new TextDecoder('utf-8', {
        fatal: true
      });

    this.stringCache = new Map();

    this.restrictionCount =
      this.restrictionView.getUint32(
        8,
        true
      );

    this.restrictionRecordBytes =
      this.restrictionView.getUint32(
        12,
        true
      );

    if (
      this.restrictionRecordBytes !== 16
    ) {
      throw new Error(
        'Routing restrictions use an unsupported record size.'
      );
    }

    requireLength(
      this.restrictionView,
      RESTRICTION_HEADER_BYTES +
        this.restrictionCount *
          this.restrictionRecordBytes,
      'Routing turn restrictions'
    );

    this.restrictionOffsets =
      new Uint32Array(
        this.nodeCount + 1
      );

    let previousViaNode = -1;

    for (
      let index = 0;
      index < this.restrictionCount;
      index += 1
    ) {
      const offset =
        RESTRICTION_HEADER_BYTES +
        index * this.restrictionRecordBytes;

      const viaNode =
        this.restrictionView.getUint32(
          offset,
          true
        );

      const fromRoad =
        this.restrictionView.getUint32(
          offset + 4,
          true
        );

      const toRoad =
        this.restrictionView.getUint32(
          offset + 8,
          true
        );

      if (
        viaNode >= this.nodeCount ||
        fromRoad >= this.roadCount ||
        toRoad >= this.roadCount ||
        viaNode < previousViaNode
      ) {
        throw new Error(
          'Routing turn restrictions reference invalid topology.'
        );
      }

      this.restrictionOffsets[
        viaNode + 1
      ] += 1;

      previousViaNode = viaNode;
    }

    for (
      let index = 1;
      index < this.restrictionOffsets.length;
      index += 1
    ) {
      this.restrictionOffsets[index] +=
        this.restrictionOffsets[index - 1];
    }

    this.cellSizeDegrees =
      this.gridView.getUint32(8, true) /
      1_000_000;

    this.cellCount =
      this.gridView.getUint32(12, true);

    this.gridEntryCount =
      this.gridView.getUint32(16, true);

    this.cellRecordBytes =
      this.gridView.getUint32(20, true);

    if (
      !Number.isFinite(this.cellSizeDegrees) ||
      this.cellSizeDegrees <= 0 ||
      this.cellRecordBytes !== 16 ||
      this.gridEntryCount !== this.nodeCount
    ) {
      throw new Error(
        'Routing spatial-index metadata is inconsistent.'
      );
    }

    this.cellRecordsByteOffset =
      GRID_HEADER_BYTES;

    this.gridEntriesByteOffset =
      this.cellRecordsByteOffset +
      this.cellCount *
        this.cellRecordBytes;

    requireLength(
      this.gridView,
      this.gridEntriesByteOffset +
        this.gridEntryCount * 4,
      'Routing spatial index'
    );

    this.metadata = metadata;
  }

  node(nodeIndex) {
    this.#requireNode(nodeIndex);

    const offset =
      NODE_HEADER_BYTES +
      nodeIndex *
        this.nodeRecordBytes;

    return {
      lat: this.nodeView.getFloat32(
        offset,
        true
      ),
      lon: this.nodeView.getFloat32(
        offset + 4,
        true
      ),
      component:
        this.nodeView.getUint32(
          offset + 8,
          true
        )
    };
  }

  latitude(nodeIndex) {
    this.#requireNode(nodeIndex);

    return this.nodeView.getFloat32(
      NODE_HEADER_BYTES +
        nodeIndex *
          this.nodeRecordBytes,
      true
    );
  }

  longitude(nodeIndex) {
    this.#requireNode(nodeIndex);

    return this.nodeView.getFloat32(
      NODE_HEADER_BYTES +
        nodeIndex *
          this.nodeRecordBytes +
        4,
      true
    );
  }

  component(nodeIndex) {
    this.#requireNode(nodeIndex);

    return this.nodeView.getUint32(
      NODE_HEADER_BYTES +
        nodeIndex *
          this.nodeRecordBytes +
        8,
      true
    );
  }

  edgeOffset(nodeIndex) {
    if (
      !Number.isInteger(nodeIndex) ||
      nodeIndex < 0 ||
      nodeIndex > this.nodeCount
    ) {
      throw new RangeError(
        'Routing node offset is out of range.'
      );
    }

    return this.edgeView.getUint32(
      this.edgeOffsetsByteOffset +
        nodeIndex * 4,
      true
    );
  }

  edge(edgeIndex) {
    this.#requireEdge(edgeIndex);

    const offset =
      this.edgeRecordsByteOffset +
      edgeIndex *
        this.edgeRecordBytes;

    const durationAndMetadata =
      this.edgeView.getUint32(
        offset + 8,
        true
      );

    const geometryAndDirection =
      this.edgeView.getUint32(
        offset + 12,
        true
      );

    const road = this.edgeView.getUint32(
      offset + 16,
      true
    );

    this.#requireRoad(road);

    return {
      to: this.edgeView.getUint32(
        offset,
        true
      ),
      distanceDecimeters:
        this.edgeView.getUint32(
          offset + 4,
          true
        ),
      durationCentiseconds:
        durationAndMetadata &
          0x00ffffff,
      roadClass:
        (durationAndMetadata >>> 24) &
          0x7f,
      oneWay:
        Boolean(
          durationAndMetadata &
          0x80000000
        ),
      geometryArc:
        geometryAndDirection &
          0x1fffffff,
      geometryReversed:
        Boolean(
          geometryAndDirection &
          0x80000000
        ),
      driveAllowed:
        Boolean(
          geometryAndDirection &
          0x20000000
        ),
      walkAllowed:
        Boolean(
          geometryAndDirection &
          0x40000000
        ),
      road
    };
  }

  edgeTarget(edgeIndex) {
    return this.#edgeValue(
      edgeIndex,
      0
    );
  }

  edgeDistanceDecimeters(edgeIndex) {
    return this.#edgeValue(
      edgeIndex,
      4
    );
  }

  edgeDurationCentiseconds(edgeIndex) {
    return (
      this.#edgeValue(
        edgeIndex,
        8
      ) & 0x00ffffff
    );
  }

  edgeAllowsProfile(edgeIndex, profile) {
    const metadata = this.#edgeValue(
      edgeIndex,
      12
    );

    if (profile === 'drive') {
      return Boolean(metadata & 0x20000000);
    }

    if (profile === 'walk') {
      return Boolean(metadata & 0x40000000);
    }

    throw new TypeError(
      'Routing profile must be drive or walk.'
    );
  }

  edgeRoad(edgeIndex) {
    const road = this.#edgeValue(
      edgeIndex,
      16
    );

    this.#requireRoad(road);
    return road;
  }

  road(roadIndex, geometryReversed = false) {
    this.#requireRoad(roadIndex);

    const offset =
      ROAD_HEADER_BYTES +
      roadIndex * this.roadRecordBytes;

    const stringAt = relativeOffset =>
      this.#stringAt(
        this.roadView.getUint32(
          offset + relativeOffset,
          true
        )
      );

    const turnLanes = stringAt(16);
    const directionalTurnLanes = geometryReversed
      ? stringAt(24)
      : stringAt(20);

    const flags = this.roadView.getUint32(
      offset + 32,
      true
    );

    return {
      id: roadIndex,
      name: stringAt(0),
      ref: stringAt(4),
      destination: stringAt(8),
      lanes: stringAt(12),
      turnLanes:
        directionalTurnLanes || turnLanes,
      destinationLanes: stringAt(28),
      roundabout: Boolean(flags & 1),
      link: Boolean(flags & 2),
      ...(flags & 4 ? { toll: true } : {}),
      ...(flags & 8 ? { electronicToll: true } : {})
    };
  }

  edgeIsToll(edgeIndex) {
    const road = this.edgeRoad(edgeIndex);
    const offset =
      ROAD_HEADER_BYTES +
      road * this.roadRecordBytes;

    const flags = this.roadView.getUint32(
      offset + 32,
      true
    );

    return Boolean(flags & 4);
  }

  hasTurnRestrictions(nodeIndex) {
    this.#requireNode(nodeIndex);

    return (
      this.restrictionOffsets[nodeIndex] !==
      this.restrictionOffsets[nodeIndex + 1]
    );
  }

  isTurnAllowed(
    nodeIndex,
    incomingRoad,
    outgoingRoad,
    incomingFromNode = null,
    outgoingTarget = null
  ) {
    this.#requireNode(nodeIndex);
    this.#requireRoad(outgoingRoad);

    if (!Number.isInteger(incomingRoad)) {
      return true;
    }

    this.#requireRoad(incomingRoad);

    const first =
      this.restrictionOffsets[nodeIndex];

    const end =
      this.restrictionOffsets[nodeIndex + 1];

    if (first === end) {
      return true;
    }

    let hasOnlyRestriction = false;
    let matchesOnlyRestriction = false;

    for (
      let index = first;
      index < end;
      index += 1
    ) {
      const restriction =
        this.#restriction(index);

      if (restriction.fromRoad !== incomingRoad) {
        continue;
      }

      if (!restriction.only) {
        if (
          restriction.fromRoad ===
            restriction.toRoad &&
          restriction.toRoad ===
            outgoingRoad &&
          Number.isInteger(incomingFromNode) &&
          Number.isInteger(outgoingTarget)
        ) {
          if (outgoingTarget === incomingFromNode) {
            return false;
          }

          continue;
        }

        if (
          restriction.toRoad === outgoingRoad
        ) {
          return false;
        }

        continue;
      }

      hasOnlyRestriction = true;

      if (
        restriction.toRoad === outgoingRoad &&
        (
          restriction.fromRoad !==
            restriction.toRoad ||
          !Number.isInteger(incomingFromNode) ||
          !Number.isInteger(outgoingTarget) ||
          outgoingTarget !== incomingFromNode
        )
      ) {
        matchesOnlyRestriction = true;
      }
    }

    return !hasOnlyRestriction ||
      matchesOnlyRestriction;
  }

  routePoints(startNode, edgeIndexes) {
    return this.routePath(
      startNode,
      edgeIndexes
    ).points;
  }

  routePath(startNode, edgeIndexes) {
    this.#requireNode(startNode);

    if (!Array.isArray(edgeIndexes)) {
      throw new TypeError(
        'Routing edge path must be an array.'
      );
    }

    const points = [this.node(startNode)];
    const legs = [];
    let fromNode = startNode;
    let routeDistanceMeters = 0;
    let routeDurationSeconds = 0;

    for (const edgeIndex of edgeIndexes) {
      const pointStartIndex =
        points.length - 1;

      const edge = this.edge(edgeIndex);

      if (edge.road >= this.roadCount) {
        throw new Error(
          'Routing edge references an invalid road.'
        );
      }

      this.#appendEdgeGeometry(
        edgeIndex,
        points
      );

      const distanceMeters =
        edge.distanceDecimeters / 10;

      const durationSeconds =
        edge.durationCentiseconds / 100;

      legs.push({
        edgeIndex,
        fromNode,
        toNode: edge.to,
        pointStartIndex,
        pointEndIndex: points.length - 1,
        distanceMeters,
        durationSeconds,
        routeDistanceStartMeters:
          routeDistanceMeters,
        routeDistanceEndMeters:
          routeDistanceMeters +
            distanceMeters,
        routeDurationStartSeconds:
          routeDurationSeconds,
        routeDurationEndSeconds:
          routeDurationSeconds +
            durationSeconds,
        roadIndex: edge.road,
        road: this.road(
          edge.road,
          edge.geometryReversed
        ),
        roadClass: edge.roadClass,
        oneWay: edge.oneWay
      });

      routeDistanceMeters += distanceMeters;
      routeDurationSeconds += durationSeconds;
      fromNode = edge.to;
    }

    return {
      points,
      legs,
      distanceMeters: routeDistanceMeters,
      durationSeconds: routeDurationSeconds
    };
  }

  outgoingEdges(nodeIndex) {
    this.#requireNode(nodeIndex);

    const edges = [];

    for (
      let edgeIndex = this.edgeOffset(nodeIndex);
      edgeIndex < this.edgeOffset(nodeIndex + 1);
      edgeIndex += 1
    ) {
      edges.push({
        edgeIndex,
        ...this.edge(edgeIndex)
      });
    }

    return edges;
  }

  findNearest(
    point,
    {
      maxDistanceMeters = 2_000,
      profile = null
    } = {}
  ) {
    if (
      !Number.isFinite(point?.lat) ||
      !Number.isFinite(point?.lon)
    ) {
      throw new TypeError(
        'Road snapping requires lat and lon.'
      );
    }

    if (
      profile !== null &&
      profile !== 'drive' &&
      profile !== 'walk'
    ) {
      throw new TypeError(
        'Road snapping profile must be drive or walk.'
      );
    }

    const profileMask =
      profile === 'drive'
        ? this.driveNodeMask
        : profile === 'walk'
          ? this.walkNodeMask
          : null;

    const latitudeRadians =
      point.lat * Math.PI / 180;

    const metersPerLatitudeDegree =
      111_320;

    const metersPerLongitudeDegree =
      metersPerLatitudeDegree *
      Math.max(
        Math.cos(latitudeRadians),
        0.01
      );

    const xRadius =
      Math.ceil(
        maxDistanceMeters /
        metersPerLongitudeDegree /
        this.cellSizeDegrees
      ) + 1;

    const yRadius =
      Math.ceil(
        maxDistanceMeters /
        metersPerLatitudeDegree /
        this.cellSizeDegrees
      ) + 1;

    const centerX = Math.floor(
      point.lon /
      this.cellSizeDegrees
    );

    const centerY = Math.floor(
      point.lat /
      this.cellSizeDegrees
    );

    let nearestNode = -1;
    let nearestDistance = Infinity;

    for (
      let x = centerX - xRadius;
      x <= centerX + xRadius;
      x += 1
    ) {
      for (
        let y = centerY - yRadius;
        y <= centerY + yRadius;
        y += 1
      ) {
        const cell = this.#findCell(x, y);

        if (!cell) {
          continue;
        }

        for (
          let index = cell.offset;
          index < cell.offset + cell.count;
          index += 1
        ) {
          const nodeIndex =
            this.gridView.getUint32(
              this.gridEntriesByteOffset +
                index * 4,
              true
            );

          if (nodeIndex >= this.nodeCount) {
            throw new Error(
              'Routing spatial index references an invalid node.'
            );
          }

          if (profileMask && !profileMask[nodeIndex]) {
            continue;
          }

          const node = this.node(nodeIndex);

          const distance =
            distanceMeters(
              point,
              node
            );

          if (distance < nearestDistance) {
            nearestNode = nodeIndex;
            nearestDistance = distance;
          }
        }
      }
    }

    if (
      nearestNode < 0 ||
      nearestDistance > maxDistanceMeters
    ) {
      return null;
    }

    return {
      node: nearestNode,
      point: this.node(nearestNode),
      distanceMeters: nearestDistance
    };
  }

  #appendEdgeGeometry(
    edgeIndex,
    points
  ) {
    this.#requireEdge(edgeIndex);

    const geometryAndDirection =
      this.#edgeValue(
        edgeIndex,
        12
      );

    const geometryArc =
      geometryAndDirection &
      0x1fffffff;

    const reversed = Boolean(
      geometryAndDirection &
      0x80000000
    );

    if (geometryArc >= this.geometryArcCount) {
      throw new Error(
        'Routing edge references invalid geometry.'
      );
    }

    const arcOffset =
      this.geometryArcsByteOffset +
      geometryArc *
        this.geometryArcRecordBytes;

    const pointOffset =
      this.geometryView.getUint32(
        arcOffset,
        true
      );

    const pointCount =
      this.geometryView.getUint32(
        arcOffset + 4,
        true
      );

    if (
      pointOffset + pointCount >
      this.geometryPointCount
    ) {
      throw new Error(
        'Routing geometry arc exceeds its point array.'
      );
    }

    for (
      let index = 0;
      index < pointCount;
      index += 1
    ) {
      const geometryIndex = reversed
        ? pointOffset + pointCount - index - 1
        : pointOffset + index;

      const offset =
        this.geometryPointsByteOffset +
        geometryIndex *
          this.geometryPointRecordBytes;

      points.push({
        lat: this.geometryView.getFloat32(
          offset,
          true
        ),
        lon: this.geometryView.getFloat32(
          offset + 4,
          true
        )
      });
    }

    points.push(
      this.node(
        this.edgeTarget(edgeIndex)
      )
    );
  }

  #findCell(x, y) {
    let low = 0;
    let high = this.cellCount - 1;

    while (low <= high) {
      const middle =
        low + Math.floor(
          (high - low) / 2
        );

      const offset =
        this.cellRecordsByteOffset +
        middle *
          this.cellRecordBytes;

      const cellX =
        this.gridView.getInt32(
          offset,
          true
        );

      const cellY =
        this.gridView.getInt32(
          offset + 4,
          true
        );

      if (
        cellX === x &&
        cellY === y
      ) {
        return {
          offset:
            this.gridView.getUint32(
              offset + 8,
              true
            ),
          count:
            this.gridView.getUint32(
              offset + 12,
              true
            )
        };
      }

      if (
        cellX < x ||
        (cellX === x && cellY < y)
      ) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return null;
  }

  #requireNode(nodeIndex) {
    if (
      !Number.isInteger(nodeIndex) ||
      nodeIndex < 0 ||
      nodeIndex >= this.nodeCount
    ) {
      throw new RangeError(
        'Routing node is out of range.'
      );
    }
  }

  #requireEdge(edgeIndex) {
    if (
      !Number.isInteger(edgeIndex) ||
      edgeIndex < 0 ||
      edgeIndex >= this.edgeCount
    ) {
      throw new RangeError(
        'Routing edge is out of range.'
      );
    }
  }

  #requireRoad(roadIndex) {
    if (
      !Number.isInteger(roadIndex) ||
      roadIndex < 0 ||
      roadIndex >= this.roadCount
    ) {
      throw new RangeError(
        'Routing road is out of range.'
      );
    }
  }

  #stringAt(stringOffset) {
    if (
      !Number.isInteger(stringOffset) ||
      stringOffset < 0 ||
      stringOffset >= this.stringBytes
    ) {
      throw new Error(
        'Routing road references an invalid string.'
      );
    }

    if (this.stringCache.has(stringOffset)) {
      return this.stringCache.get(stringOffset);
    }

    let end = stringOffset;

    while (
      end < this.stringBytes &&
      this.stringView.getUint8(
        STRING_HEADER_BYTES + end
      ) !== 0
    ) {
      end += 1;
    }

    if (end >= this.stringBytes) {
      throw new Error(
        'Routing string is not terminated.'
      );
    }

    const bytes = new Uint8Array(
      this.stringView.buffer,
      this.stringView.byteOffset +
        STRING_HEADER_BYTES +
        stringOffset,
      end - stringOffset
    );

    const value = this.stringDecoder.decode(bytes);

    this.stringCache.set(
      stringOffset,
      value
    );

    return value;
  }

  #restriction(restrictionIndex) {
    if (
      !Number.isInteger(restrictionIndex) ||
      restrictionIndex < 0 ||
      restrictionIndex >= this.restrictionCount
    ) {
      throw new RangeError(
        'Routing turn restriction is out of range.'
      );
    }

    const offset =
      RESTRICTION_HEADER_BYTES +
      restrictionIndex *
        this.restrictionRecordBytes;

    return {
      viaNode:
        this.restrictionView.getUint32(
          offset,
          true
        ),
      fromRoad:
        this.restrictionView.getUint32(
          offset + 4,
          true
        ),
      toRoad:
        this.restrictionView.getUint32(
          offset + 8,
          true
        ),
      only: Boolean(
        this.restrictionView.getUint32(
          offset + 12,
          true
        ) & 1
      )
    };
  }

  #edgeValue(edgeIndex, fieldOffset) {
    this.#requireEdge(edgeIndex);

    return this.edgeView.getUint32(
      this.edgeRecordsByteOffset +
        edgeIndex *
          this.edgeRecordBytes +
        fieldOffset,
      true
    );
  }
}
