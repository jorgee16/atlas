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

const DRIVE_ORIGIN_PROBE_RADII_METERS = [8, 16, 24];
const DRIVE_ORIGIN_PROBE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const DRIVE_ORIGIN_MAX_ALTERNATIVE_OFFSET_METERS = 32;
const DRIVE_ORIGIN_MAX_EXTRA_DISTANCE_METERS = 18;

function pointDistanceMeters(a, b) {
  const earthRadius = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function offsetPoint(point, bearingDegrees, distanceMeters) {
  const earthRadius = 6371000;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = bearingDegrees * Math.PI / 180;
  const lat1 = point.lat * Math.PI / 180;
  const lon1 = point.lon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lon: lon2 * 180 / Math.PI
  };
}

function driveNodeQuality(graph, nodeIndex) {
  const outgoing = graph
    .outgoingEdges(nodeIndex)
    .filter(edge => edge.driveAllowed === true);
  const targets = new Set(outgoing.map(edge => edge.to));
  const roads = outgoing.map(edge => graph.road(edge.road, edge.geometryReversed));
  const namedRoad = roads.some(road => Boolean(road.name || road.ref));
  const allLinks = roads.length > 0 && roads.every(road => road.link === true);

  return {
    degree: targets.size,
    namedRoad,
    allLinks
  };
}

function driveOriginScore(graph, origin, snap) {
  const actualDistance = pointDistanceMeters(origin, snap.point);
  const quality = driveNodeQuality(graph, snap.node);

  const deadEndPenalty = quality.degree <= 1 ? 16 : 0;
  const weakJunctionPenalty = quality.degree === 2 ? 2 : 0;
  const unnamedPenalty = quality.namedRoad ? 0 : 4;
  const linkPenalty = quality.allLinks ? 4 : 0;

  return {
    score:
      actualDistance +
      deadEndPenalty +
      weakJunctionPenalty +
      unnamedPenalty +
      linkPenalty,
    actualDistance,
    quality
  };
}

function findDriveOriginSnap(
  graph,
  origin,
  {
    maxDistanceMeters,
    destinationComponent = null
  }
) {
  const direct = graph.findNearest(origin, {
    maxDistanceMeters,
    profile: 'drive'
  });

  if (!direct) return null;

  const candidates = new Map([[direct.node, direct]]);

  for (const radius of DRIVE_ORIGIN_PROBE_RADII_METERS) {
    for (const bearing of DRIVE_ORIGIN_PROBE_BEARINGS) {
      const probe = offsetPoint(origin, bearing, radius);
      const snap = graph.findNearest(probe, {
        maxDistanceMeters: 16,
        profile: 'drive'
      });

      if (!snap || candidates.has(snap.node)) continue;

      const actualDistance = pointDistanceMeters(origin, snap.point);
      if (actualDistance > DRIVE_ORIGIN_MAX_ALTERNATIVE_OFFSET_METERS) continue;
      if (
        Number.isInteger(destinationComponent) &&
        snap.point.component !== destinationComponent
      ) {
        continue;
      }

      candidates.set(snap.node, snap);
    }
  }

  const directInfo = driveOriginScore(graph, origin, direct);
  let best = direct;
  let bestInfo = directInfo;

  for (const candidate of candidates.values()) {
    if (
      Number.isInteger(destinationComponent) &&
      candidate.point.component !== destinationComponent
    ) {
      continue;
    }

    const info = driveOriginScore(graph, origin, candidate);

    if (
      info.actualDistance >
      Math.min(
        DRIVE_ORIGIN_MAX_ALTERNATIVE_OFFSET_METERS,
        directInfo.actualDistance + DRIVE_ORIGIN_MAX_EXTRA_DISTANCE_METERS
      )
    ) {
      continue;
    }

    // If GPS is already very close to a routable node, only abandon that node
    // for an obviously better connected candidate that is still almost as
    // close. This prevents snapping across a block merely to avoid a dead end.
    if (
      directInfo.actualDistance <= 12 &&
      candidate.node !== direct.node &&
      (
        directInfo.quality.degree > 1 ||
        info.quality.degree < 2 ||
        info.actualDistance > directInfo.actualDistance + 10
      )
    ) {
      continue;
    }

    if (info.score < bestInfo.score) {
      best = candidate;
      bestInfo = info;
    }
  }

  return {
    ...best,
    snapStrategy:
      best.node === direct.node
        ? 'nearest'
        : 'connected-road',
    snapScore: bestInfo.score
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

    const originSnap =
      profile === 'drive'
        ? findDriveOriginSnap(
            dataset.graph,
            origin,
            {
              maxDistanceMeters:
                this.maximumSnapDistanceMeters,
              destinationComponent:
                destinationSnap.point.component
            }
          )
        : dataset.graph.findNearest(
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

    const calibratedRoute =
      profile === 'drive'
        ? calibrateDriveEta(route)
        : route;

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
