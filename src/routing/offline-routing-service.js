import {
  AStarRouter
} from './astar-router.js';

import {
  RoutingRepository
} from './routing-repository.js';

import {
  ManeuverGenerator
} from './maneuver-generator.js';

import {
  routeCumulativeDistances
} from './route-progress.js';

export class OfflineRoutingService {
  constructor({
    repository = new RoutingRepository(),
    maximumSnapDistanceMeters = 2_000,
    maneuverGenerator =
      new ManeuverGenerator()
  } = {}) {
    this.repository = repository;
    this.maximumSnapDistanceMeters =
      maximumSnapDistanceMeters;

    this.maneuverGenerator =
      maneuverGenerator;

    this.routers = new WeakMap();
  }

  async route(
    origin,
    destination,
    {
      signal = null,
      profile = 'drive'
    } = {}
  ) {
    if (profile !== 'drive' && profile !== 'walk') {
      throw new TypeError('Routing profile must be drive or walk.');
    }

    this.#requirePoint(origin, 'origin');
    this.#requirePoint(
      destination,
      'destination'
    );

    const dataset =
      await this.repository
        .loadForEndpoints(
          origin,
          destination
        );

    if (signal?.aborted) {
      const error = new Error(
        'Route calculation was cancelled.'
      );

      error.name = 'AbortError';
      throw error;
    }

    const originSnap =
      dataset.graph.findNearest(
        origin,
        {
          maxDistanceMeters:
            this.maximumSnapDistanceMeters,
          profile
        }
      );

    if (!originSnap) {
      throw new Error(
        'No routable road was found near the starting point.'
      );
    }

    const destinationSnap =
      dataset.graph.findNearest(
        destination,
        {
          maxDistanceMeters:
            this.maximumSnapDistanceMeters,
          profile
        }
      );

    if (!destinationSnap) {
      throw new Error(
        'No routable road was found near the destination.'
      );
    }

    if (
      originSnap.point.component !==
      destinationSnap.point.component
    ) {
      throw new Error(
        'No continuous road connection exists between these endpoints.'
      );
    }

    let router =
      this.routers.get(dataset.graph);

    if (!router) {
      router = new AStarRouter(
        dataset.graph
      );

      this.routers.set(
        dataset.graph,
        router
      );
    }

    const route = await router.route(
      originSnap.node,
      destinationSnap.node,
      { signal, profile }
    );

    if (!route) {
      throw new Error(
        profile === 'walk'
          ? 'No walking route connects these endpoints.'
          : 'No legal car route connects these endpoints.'
      );
    }

    route.cumulativeDistances =
      routeCumulativeDistances(
        route.points
      );

    route.maneuvers =
      this.maneuverGenerator.generate({
        graph: dataset.graph,
        route,
        destination
      });

    return {
      ...route,
      regionId: dataset.region.id,
      partitionId:
        dataset.partitionId ?? null,
      profile,
      originSnap,
      destinationSnap
    };
  }

  #requirePoint(point, label) {
    if (
      !Number.isFinite(point?.lat) ||
      !Number.isFinite(point?.lon)
    ) {
      throw new TypeError(
        `Offline routing ${label} requires lat and lon.`
      );
    }
  }
}
