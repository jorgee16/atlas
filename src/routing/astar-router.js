import {
  MinPriorityQueue
} from './min-priority-queue.js';

import {
  edgeIsTolledInPortugal,
  estimateEdgeTollEuros
} from './portugal-toll-estimator.js';

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_PROFILE_SPEED_METERS_PER_SECOND =
  140 / 3.6;
const WALK_SPEED_METERS_PER_SECOND = 1.4;

function abortError() {
  const error = new Error(
    'Route calculation was cancelled.'
  );

  error.name = 'AbortError';
  return error;
}

function haversineMeters(
  fromLat,
  fromLon,
  toLat,
  toLon
) {
  const radians = Math.PI / 180;

  const fromLatitude =
    fromLat * radians;

  const toLatitude =
    toLat * radians;

  const deltaLatitude =
    (toLat - fromLat) * radians;

  const deltaLongitude =
    (toLon - fromLon) * radians;

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;

  return EARTH_RADIUS_METERS *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );
}

function nextFrame() {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

export class AStarRouter {
  constructor(graph) {
    if (!graph) {
      throw new TypeError(
        'AStarRouter requires a routing graph.'
      );
    }

    this.graph = graph;
    this.queue = new MinPriorityQueue();

    this.seenGeneration =
      new Uint32Array(graph.nodeCount);

    this.costs =
      new Uint32Array(graph.nodeCount);

    this.predecessors =
      new Int32Array(graph.nodeCount);

    this.predecessorEdges =
      new Uint32Array(graph.nodeCount);

    this.virtualStateByKey = new Map();
    this.virtualNodes = [];
    this.virtualIncomingRoads = [];
    this.virtualIncomingFromNodes = [];
    this.virtualCosts = [];
    this.virtualPredecessors = [];
    this.virtualPredecessorEdges = [];
    this.virtualSeenGenerations = [];

    this.generation = 0;
  }

  async route(
    start,
    goal,
    {
      signal = null,
      yieldEvery = 8_000,
      maximumExpandedNodes = 2_000_000,
      yieldControl = nextFrame,
      profile = 'drive',
      avoidTolls = false,
      tollPenaltyMinutesPerEuro = 0,
      vehicleClass = 1
    } = {}
  ) {
    if (profile !== 'drive' && profile !== 'walk') {
      throw new TypeError('A* profile must be drive or walk.');
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(goal) ||
      start < 0 ||
      goal < 0 ||
      start >= this.graph.nodeCount ||
      goal >= this.graph.nodeCount
    ) {
      throw new RangeError(
        'A* endpoints must be valid routing nodes.'
      );
    }

    if (
      this.graph.component(start) !==
      this.graph.component(goal)
    ) {
      return null;
    }

    if (signal?.aborted) {
      throw abortError();
    }

    const generation =
      this.#nextGeneration();

    const goalLat =
      this.graph.latitude(goal);

    const goalLon =
      this.graph.longitude(goal);

    this.queue.clear();
    this.#clearVirtualStates();
    this.seenGeneration[start] = generation;
    this.costs[start] = 0;
    this.predecessors[start] = -1;

    this.queue.push(
      start,
      this.#heuristic(
        start,
        goalLat,
        goalLon
      )
    );

    let expandedNodes = 0;

    while (this.queue.size) {
      if (signal?.aborted) {
        throw abortError();
      }

      const current = this.queue.pop();

      const currentNode =
        this.#stateNode(current.node);

      const currentCost =
        this.#stateCost(current.node);

      const expectedPriority =
        currentCost +
        this.#heuristic(
          currentNode,
          goalLat,
          goalLon
        );

      if (
        current.priority >
        expectedPriority
      ) {
        continue;
      }

      if (currentNode === goal) {
        return this.#buildRoute({
          start,
          goal,
          goalState: current.node,
          generation,
          expandedNodes,
          profile
        });
      }

      expandedNodes += 1;

      if (
        expandedNodes >
        maximumExpandedNodes
      ) {
        throw new Error(
          'The offline route is too large for this device.'
        );
      }

      const startEdge =
        this.graph.edgeOffset(currentNode);

      const endEdge =
          this.graph.edgeOffset(
          currentNode + 1
        );

      const incomingRoad =
        this.#stateIncomingRoad(
          current.node
        );

      const incomingFromNode =
        this.#stateIncomingFromNode(
          current.node
        );

      for (
        let edgeIndex = startEdge;
        edgeIndex < endEdge;
        edgeIndex += 1
      ) {
        if (!this.graph.edgeAllowsProfile(
          edgeIndex,
          profile
        )) {
          continue;
        }

        if (
          profile === 'drive' &&
          avoidTolls &&
          edgeIsTolledInPortugal(
            this.graph,
            edgeIndex
          )
        ) {
          continue;
        }

        const target =
          this.graph.edgeTarget(edgeIndex);

        const outgoingRoad =
          this.graph.edgeRoad(edgeIndex);

        if (
          profile === 'drive' &&
          !this.graph.isTurnAllowed(
            currentNode,
            incomingRoad,
            outgoingRoad,
            incomingFromNode,
            target
          )
        ) {
          continue;
        }

        const targetState =
          this.#stateForArrival(
            target,
            outgoingRoad,
            edgeIndex,
            currentNode
          );

        const baseEdgeCost =
          profile === 'walk'
            ? Math.max(
                1,
                Math.round(
                  (this.graph.edgeDistanceDecimeters(edgeIndex) / 10) /
                    WALK_SPEED_METERS_PER_SECOND *
                    100
                )
              )
            : this.graph.edgeDurationCentiseconds(edgeIndex);

        const tollPenalty =
          profile === 'drive' &&
          tollPenaltyMinutesPerEuro > 0
            ? Math.round(
                estimateEdgeTollEuros(
                  this.graph,
                  edgeIndex,
                  vehicleClass
                ) *
                tollPenaltyMinutesPerEuro *
                60 *
                100
              )
            : 0;

        const edgeCost =
          baseEdgeCost + tollPenalty;

        const nextCost =
          currentCost + edgeCost;

        if (nextCost > 0xffffffff) {
          continue;
        }

        if (
          !this.#stateSeen(
            targetState,
            generation
          ) ||
          nextCost <
            this.#stateCost(targetState)
        ) {
          this.#setState(
            targetState,
            generation,
            nextCost,
            current.node,
            edgeIndex
          );

          this.queue.push(
            targetState,
            nextCost +
              this.#heuristic(
                target,
                goalLat,
                goalLon
              )
          );
        }
      }

      if (
        Number.isFinite(yieldEvery) &&
        yieldEvery > 0 &&
        expandedNodes % yieldEvery === 0
      ) {
        await yieldControl();
      }
    }

    return null;
  }

  #clearVirtualStates() {
    this.virtualStateByKey.clear();
    this.virtualNodes.length = 0;
    this.virtualIncomingRoads.length = 0;
    this.virtualIncomingFromNodes.length = 0;
    this.virtualCosts.length = 0;
    this.virtualPredecessors.length = 0;
    this.virtualPredecessorEdges.length = 0;
    this.virtualSeenGenerations.length = 0;
  }

  #stateForArrival(
    node,
    incomingRoad,
    incomingEdge,
    incomingFromNode
  ) {
    if (!this.graph.hasTurnRestrictions(node)) {
      return node;
    }

    const key = `${node}:${incomingEdge}`;
    const existing =
      this.virtualStateByKey.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const virtualIndex =
      this.virtualNodes.length;

    const state =
      this.graph.nodeCount + virtualIndex;

    this.virtualStateByKey.set(key, state);
    this.virtualNodes.push(node);
    this.virtualIncomingRoads.push(
      incomingRoad
    );
    this.virtualIncomingFromNodes.push(
      incomingFromNode
    );
    this.virtualCosts.push(0);
    this.virtualPredecessors.push(-1);
    this.virtualPredecessorEdges.push(0);
    this.virtualSeenGenerations.push(0);

    return state;
  }

  #stateNode(state) {
    if (state < this.graph.nodeCount) {
      return state;
    }

    const virtualIndex =
      state - this.graph.nodeCount;

    const node =
      this.virtualNodes[virtualIndex];

    if (!Number.isInteger(node)) {
      throw new Error(
        'A* referenced an invalid restricted-turn state.'
      );
    }

    return node;
  }

  #stateIncomingRoad(state) {
    if (state < this.graph.nodeCount) {
      return null;
    }

    return this.virtualIncomingRoads[
      state - this.graph.nodeCount
    ];
  }

  #stateIncomingFromNode(state) {
    if (state < this.graph.nodeCount) {
      return null;
    }

    return this.virtualIncomingFromNodes[
      state - this.graph.nodeCount
    ];
  }

  #stateSeen(state, generation) {
    if (state < this.graph.nodeCount) {
      return this.seenGeneration[state] ===
        generation;
    }

    return this.virtualSeenGenerations[
      state - this.graph.nodeCount
    ] === generation;
  }

  #stateCost(state) {
    if (state < this.graph.nodeCount) {
      return this.costs[state];
    }

    return this.virtualCosts[
      state - this.graph.nodeCount
    ];
  }

  #statePredecessor(state) {
    if (state < this.graph.nodeCount) {
      return this.predecessors[state];
    }

    return this.virtualPredecessors[
      state - this.graph.nodeCount
    ];
  }

  #statePredecessorEdge(state) {
    if (state < this.graph.nodeCount) {
      return this.predecessorEdges[state];
    }

    return this.virtualPredecessorEdges[
      state - this.graph.nodeCount
    ];
  }

  #setState(
    state,
    generation,
    cost,
    predecessor,
    predecessorEdge
  ) {
    if (state < this.graph.nodeCount) {
      this.seenGeneration[state] = generation;
      this.costs[state] = cost;
      this.predecessors[state] = predecessor;
      this.predecessorEdges[state] =
        predecessorEdge;
      return;
    }

    const virtualIndex =
      state - this.graph.nodeCount;

    this.virtualSeenGenerations[
      virtualIndex
    ] = generation;

    this.virtualCosts[virtualIndex] = cost;
    this.virtualPredecessors[virtualIndex] =
      predecessor;
    this.virtualPredecessorEdges[
      virtualIndex
    ] = predecessorEdge;
  }

  #nextGeneration() {
    this.generation =
      (this.generation + 1) >>> 0;

    if (this.generation === 0) {
      this.seenGeneration.fill(0);
      this.generation = 1;
    }

    return this.generation;
  }

  #heuristic(node, goalLat, goalLon) {
    const meters = haversineMeters(
      this.graph.latitude(node),
      this.graph.longitude(node),
      goalLat,
      goalLon
    );

    return Math.floor(
      meters /
      MAX_PROFILE_SPEED_METERS_PER_SECOND *
      100
    );
  }

  #buildRoute({
    start,
    goal,
    goalState,
    generation,
    expandedNodes,
    profile
  }) {
    const reversedNodes = [];
    const reversedEdges = [];
    let distanceDecimeters = 0;
    let currentState = goalState;

    while (true) {
      if (
        !this.#stateSeen(
          currentState,
          generation
        )
      ) {
        throw new Error(
          'A* produced an incomplete route.'
        );
      }

      const currentNode =
        this.#stateNode(currentState);

      reversedNodes.push(currentNode);

      if (currentNode === start) {
        break;
      }

      const predecessorEdge =
        this.#statePredecessorEdge(
          currentState
        );

      reversedEdges.push(
        predecessorEdge
      );

      distanceDecimeters +=
        this.graph.edgeDistanceDecimeters(
          predecessorEdge
        );

      currentState =
        this.#statePredecessor(
          currentState
        );

      if (currentState < 0) {
        throw new Error(
          'A* produced an invalid predecessor chain.'
        );
      }
    }

    reversedNodes.reverse();
    reversedEdges.reverse();

    const routePath = this.graph.routePath(
      start,
      reversedEdges
    );

    const durationCentiseconds =
      reversedEdges.reduce(
        (total, edgeIndex) =>
          total + (
            profile === 'walk'
              ? Math.max(
                  1,
                  Math.round(
                    (this.graph.edgeDistanceDecimeters(edgeIndex) / 10) /
                      WALK_SPEED_METERS_PER_SECOND *
                      100
                  )
                )
              : this.graph.edgeDurationCentiseconds(edgeIndex)
          ),
        0
      );

    return {
      nodeIndexes: reversedNodes,
      edgeIndexes: reversedEdges,
      points: routePath.points,
      legs: routePath.legs,
      distanceMeters:
        distanceDecimeters / 10,
      durationSeconds:
        durationCentiseconds / 100,
      expandedNodes
    };
  }
}
