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

import {
  estimateRouteTolls
} from './portugal-toll-estimator.js';

import {
  DRIVE_TOLL_PENALTIES_MINUTES_PER_EURO,
  selectBalancedDriveRoute
} from './drive-route-options.js';
import {
  summarizeRouteRoadRefs
} from './route-road-summary.js';

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
      profile = 'drive',
      avoidTolls = false,
      tollPenaltyMinutesPerEuro = 0,
      vehicleClass = 1
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

    // The stored component id is graph-global, not profile-specific.
    // Keep the fast connectivity rejection for Drive, but let the
    // walk-aware A* determine pedestrian connectivity itself.
    if (
      profile === 'drive' &&
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
      {
        signal,
        profile,
        avoidTolls,
        tollPenaltyMinutesPerEuro,
        vehicleClass
      }
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
      destinationSnap,
      roadRefs:
        profile === 'drive'
          ? summarizeRouteRoadRefs(
              dataset.graph,
              route
            )
          : [],
      tolls:
        profile === 'drive'
          ? estimateRouteTolls(
              dataset.graph,
              route,
              { vehicleClass }
            )
          : {
              vehicleClass,
              estimated: false,
              totalEuros: 0,
              tolledDistanceMeters: 0,
              roads: []
            }
    };
  }

  async driveOptions(
    origin,
    destination,
    {
      signal = null,
      vehicleClass = 1
    } = {}
  ) {
    const policies =
      DRIVE_TOLL_PENALTIES_MINUTES_PER_EURO.map(
        penalty => ({
          kind: penalty === 0
            ? 'fastest'
            : 'candidate',
          penalty
        })
      );

    const candidates = [];

    for (const policy of policies) {
      const candidate = await this.route(
        origin,
        destination,
        {
          signal,
          profile: 'drive',
          tollPenaltyMinutesPerEuro:
            policy.penalty,
          vehicleClass
        }
      );

      candidate.routePolicy = policy.kind;
      candidates.push(candidate);
    }

    try {
      const noTolls = await this.route(
        origin,
        destination,
        {
          signal,
          profile: 'drive',
          avoidTolls: true,
          vehicleClass
        }
      );

      noTolls.routePolicy = 'no-tolls';
      candidates.push(noTolls);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      // Some islands/areas can genuinely have no toll-free connection.
    }

    const unique = [];
    const signatures = new Set();

    for (const candidate of candidates) {
      const signature =
        candidate.edgeIndexes.join(',');

      if (signatures.has(signature)) {
        continue;
      }

      signatures.add(signature);
      unique.push(candidate);
    }

    unique.sort(
      (a, b) =>
        a.durationSeconds - b.durationSeconds ||
        a.tolls.totalEuros - b.tolls.totalEuros
    );

    const frontier = unique.filter(
      candidate =>
        !unique.some(other =>
          other !== candidate &&
          other.durationSeconds <=
            candidate.durationSeconds &&
          other.tolls.totalEuros <=
            candidate.tolls.totalEuros &&
          (
            other.durationSeconds <
              candidate.durationSeconds ||
            other.tolls.totalEuros <
              candidate.tolls.totalEuros
          )
        )
    );

    const fastest = frontier.reduce(
      (best, route) =>
        !best || route.durationSeconds < best.durationSeconds
          ? route
          : best,
      null
    );

    const noTolls = frontier
      .filter(route => route.tolls.totalEuros === 0)
      .reduce(
        (best, route) =>
          !best || route.durationSeconds < best.durationSeconds
            ? route
            : best,
        null
      );

    const balanced = selectBalancedDriveRoute(
      frontier,
      fastest,
      noTolls
    );

    const output = [];
    const add = (kind, route, recommended = false) => {
      if (!route || output.some(item => item.route === route)) {
        return;
      }

      output.push({
        kind,
        label:
          kind === 'fastest'
            ? 'Fastest'
            : kind === 'balanced'
              ? 'Balanced'
              : 'No tolls',
        recommended,
        route
      });
    };

    add('fastest', fastest);
    add('balanced', balanced, balanced !== fastest);
    add('no-tolls', noTolls);

    return output;
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
