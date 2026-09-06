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
import { calibrateDriveEta } from './drive-eta.js';
import {
  appendDriveSegmentToRoute,
  buildDriveRouteBetweenSegmentSnaps,
  findDriveDestinationRoadSegmentSnaps,
  findDriveRoadSegmentSnaps,
  prependDriveSegmentToRoute
} from './road-segment-snap.js';
import {
  buildShortWalkGeometry
} from './walk-segment-snap.js';
import {
  distanceMeters
} from '../features/navigation/navigation-geometry.js';

const DRIVE_ORIGIN_DEAD_END_PENALTY_SECONDS = 50;
const DRIVE_ORIGIN_WEAK_CONNECTION_PENALTY_SECONDS = 8;
const DRIVE_ORIGIN_LINK_PENALTY_SECONDS = 5;
const DRIVE_ORIGIN_HEADING_PENALTY_SECONDS = 70;
const WALK_SPEED_METERS_PER_SECOND = 1.4;

function routeSignature(route) {
  return (route?.edgeIndexes ?? []).join(',');
}

function expandZeroEdgeWalkRoute(
  route,
  {
    graph,
    origin,
    destination,
    originSnap,
    destinationSnap
  }
) {
  if (
    (route?.edgeIndexes?.length ?? 0) > 0 ||
    (route?.points?.length ?? 0) > 1
  ) {
    return route;
  }

  const sharedNode =
    originSnap?.node ??
    destinationSnap?.node ??
    null;

  const roadGeometry =
    buildShortWalkGeometry(
      graph,
      origin,
      destination,
      sharedNode
    );

  if (roadGeometry) {
    return {
      ...route,
      ...roadGeometry
    };
  }

  const directDistance =
    distanceMeters(origin, destination);

  return {
    ...route,
    points: [
      { lat: origin.lat, lon: origin.lon },
      { lat: destination.lat, lon: destination.lon }
    ],
    distanceMeters: directDistance,
    durationSeconds:
      directDistance /
      WALK_SPEED_METERS_PER_SECOND
  };
}

function publicSegmentSnap(segmentSnap) {
  if (!segmentSnap) return null;

  return {
    node: segmentSnap.node,
    point: segmentSnap.point,
    distanceMeters: segmentSnap.distanceMeters,
    component: segmentSnap.component,
    edgeIndex: segmentSnap.edgeIndex,
    roadIndex: segmentSnap.roadIndex,
    snapStrategy: segmentSnap.snapStrategy,
    deadEnd: segmentSnap.deadEnd,
    weaklyConnected: segmentSnap.weaklyConnected,
    headingMismatchDegrees:
      segmentSnap.headingMismatchDegrees ?? null
  };
}

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
      vehicleClass = 1,
      heading = null,
      speed = null
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

    const nearestDestinationNode =
      dataset.graph.findNearest(
        destination,
        {
          maxDistanceMeters:
            this.maximumSnapDistanceMeters,
          profile
        }
      );

    if (!nearestDestinationNode) {
      throw new Error(
        'No routable road was found near the destination.'
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

    let originSnap = null;
    let destinationSnap = nearestDestinationNode;
    let route = null;

    if (profile === 'drive') {
      const destinationSegmentSnaps =
        findDriveDestinationRoadSegmentSnaps(
          dataset.graph,
          destination,
          {
            maxDistanceMeters: Math.min(
              80,
              this.maximumSnapDistanceMeters
            ),
            maximumCandidates: 6,
            component:
              nearestDestinationNode.point.component
          }
        );

      const originSegmentSnaps =
        findDriveRoadSegmentSnaps(
          dataset.graph,
          origin,
          {
            maxDistanceMeters: Math.min(
              55,
              this.maximumSnapDistanceMeters
            ),
            maximumCandidates: 6,
            destinationComponent:
              nearestDestinationNode.point.component,
            heading,
            speed
          }
        );

      let best = null;

      const effectiveDestinationSnaps =
        destinationSegmentSnaps.length
          ? destinationSegmentSnaps
          : [null];

      for (const segmentSnap of originSegmentSnaps) {
        for (const destinationSegmentSnap of effectiveDestinationSnaps) {
          if (signal?.aborted) {
            const error = new Error(
              'Route calculation was cancelled.'
            );
            error.name = 'AbortError';
            throw error;
          }

          let candidateRoute = null;

          if (destinationSegmentSnap) {
            candidateRoute =
              buildDriveRouteBetweenSegmentSnaps(
                segmentSnap,
                destinationSegmentSnap
              );
          }

          if (!candidateRoute) {
            const goalNode = destinationSegmentSnap
              ? destinationSegmentSnap.node
              : nearestDestinationNode.node;

            candidateRoute = await router.route(
              segmentSnap.node,
              goalNode,
              {
                signal,
                profile,
                avoidTolls,
                tollPenaltyMinutesPerEuro,
                vehicleClass
              }
            );

            if (!candidateRoute) continue;

            candidateRoute =
              prependDriveSegmentToRoute(
                candidateRoute,
                segmentSnap
              );

            if (destinationSegmentSnap) {
              candidateRoute =
                appendDriveSegmentToRoute(
                  candidateRoute,
                  destinationSegmentSnap
                );
            }
          }

          const topologyPenalty =
            (segmentSnap.deadEnd
              ? DRIVE_ORIGIN_DEAD_END_PENALTY_SECONDS
              : 0) +
            (segmentSnap.weaklyConnected
              ? DRIVE_ORIGIN_WEAK_CONNECTION_PENALTY_SECONDS
              : 0) +
            (segmentSnap.road?.link === true
              ? DRIVE_ORIGIN_LINK_PENALTY_SECONDS
              : 0);

          const headingPenalty =
            Number.isFinite(speed) && speed >= 2
              ? Math.pow(
                  Math.min(180, segmentSnap.headingMismatchDegrees ?? 0) / 180,
                  1.5
                ) * DRIVE_ORIGIN_HEADING_PENALTY_SECONDS
              : 0;

          const destinationDistance =
            destinationSegmentSnap?.distanceMeters ??
            nearestDestinationNode.distanceMeters ??
            0;

          const score =
            candidateRoute.durationSeconds +
            segmentSnap.distanceMeters * 0.35 +
            destinationDistance * 0.2 +
            topologyPenalty +
            headingPenalty;

          if (!best || score < best.score) {
            best = {
              score,
              route: candidateRoute,
              originSnap: segmentSnap,
              destinationSnap: destinationSegmentSnap
            };
          }
        }
      }

      if (best) {
        route = best.route;
        originSnap = publicSegmentSnap(best.originSnap);
        destinationSnap = best.destinationSnap
          ? publicSegmentSnap(best.destinationSnap)
          : nearestDestinationNode;
      }
    }

    if (!route) {
      originSnap = dataset.graph.findNearest(
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

      if (
        profile === 'drive' &&
        originSnap.point.component !==
        nearestDestinationNode.point.component
      ) {
        throw new Error(
          'No continuous road connection exists between these endpoints.'
        );
      }

      route = await router.route(
        originSnap.node,
        nearestDestinationNode.node,
        {
          signal,
          profile,
          avoidTolls,
          tollPenaltyMinutesPerEuro,
          vehicleClass
        }
      );
      destinationSnap = nearestDestinationNode;
    }

    if (!route) {
      throw new Error(
        profile === 'walk'
          ? 'No walking route connects these endpoints.'
          : 'No legal car route connects these endpoints.'
      );
    }

    const normalizedRoute =
      profile === 'walk'
        ? expandZeroEdgeWalkRoute(
            route,
            {
              graph: dataset.graph,
              origin,
              destination,
              originSnap,
              destinationSnap
            }
          )
        : route;

    const calibratedRoute =
      profile === 'drive'
        ? calibrateDriveEta(normalizedRoute)
        : normalizedRoute;

    calibratedRoute.cumulativeDistances =
      routeCumulativeDistances(
        calibratedRoute.points
      );

    calibratedRoute.maneuvers =
      this.maneuverGenerator.generate({
        graph: dataset.graph,
        route: calibratedRoute,
        destination
      });

    return {
      ...calibratedRoute,
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
              normalizedRoute
            )
          : [],
      tolls:
        profile === 'drive'
          ? estimateRouteTolls(
              dataset.graph,
              normalizedRoute,
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
      candidate.routePolicyPenalty = policy.penalty;
      candidates.push(candidate);
    }

    let explicitNoTolls = null;

    try {
      explicitNoTolls = await this.route(
        origin,
        destination,
        {
          signal,
          profile: 'drive',
          avoidTolls: true,
          vehicleClass
        }
      );

      explicitNoTolls.routePolicy = 'no-tolls';
      explicitNoTolls.avoidsTolls = true;
      candidates.push(explicitNoTolls);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
    }

    const uniqueBySignature = new Map();

    for (const candidate of candidates) {
      const signature = routeSignature(candidate);
      const existing = uniqueBySignature.get(signature);

      if (!existing) {
        candidate.routePolicies = [candidate.routePolicy];
        uniqueBySignature.set(signature, candidate);
        continue;
      }

      existing.routePolicies = [
        ...new Set([
          ...(existing.routePolicies ?? [existing.routePolicy]),
          candidate.routePolicy
        ])
      ];

      if (candidate.routePolicy === 'no-tolls') {
        existing.avoidsTolls = true;
      }
    }

    const unique = [...uniqueBySignature.values()];

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

    const fastest = unique.reduce(
      (best, route) =>
        !best || route.durationSeconds < best.durationSeconds
          ? route
          : best,
      null
    );

    const explicitNoTollsSignature =
      explicitNoTolls
        ? routeSignature(explicitNoTolls)
        : null;

    const noTolls = explicitNoTollsSignature != null
      ? uniqueBySignature.get(explicitNoTollsSignature) ?? null
      : null;

    const balanced = selectBalancedDriveRoute(
      frontier.length ? frontier : unique,
      fastest,
      noTolls
    );

    const output = [];
    const outputSignatures = new Set();

    const add = (kind, route, recommended = false) => {
      if (!route) return;

      const signature = routeSignature(route);
      if (outputSignatures.has(signature)) {
        return;
      }

      outputSignatures.add(signature);
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

    add('fastest', fastest, true);
    add(
      'balanced',
      balanced,
      balanced !== fastest
    );
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
