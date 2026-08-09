import {
  bearingDegrees,
  cardinalDirection
} from '../features/navigation/navigation-geometry.js';

const STRAIGHT_THRESHOLD_DEGREES = 18;
const SLIGHT_THRESHOLD_DEGREES = 45;
const TURN_THRESHOLD_DEGREES = 135;

function normalizedTurnDelta(
  incomingBearing,
  outgoingBearing
) {
  return (
    outgoingBearing -
    incomingBearing +
    540
  ) % 360 - 180;
}

function bearingFromLeg(points, leg, atEnd) {
  const start = atEnd
    ? leg.pointEndIndex
    : leg.pointStartIndex;

  const limit = atEnd
    ? leg.pointStartIndex
    : leg.pointEndIndex;

  const step = atEnd ? -1 : 1;

  for (
    let index = start + step;
    atEnd ? index >= limit : index <= limit;
    index += step
  ) {
    const from = atEnd
      ? points[index]
      : points[start];

    const to = atEnd
      ? points[start]
      : points[index];

    if (
      from.lat !== to.lat ||
      from.lon !== to.lon
    ) {
      return bearingDegrees(from, to);
    }
  }

  return 0;
}

function roadKey(road) {
  return [road?.ref, road?.name]
    .filter(Boolean)
    .join('|')
    .trim()
    .toLocaleLowerCase();
}

function sameRoad(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left.id === right.id) {
    return true;
  }

  const leftKey = roadKey(left);
  return Boolean(leftKey) &&
    leftKey === roadKey(right);
}

export function roadLabel(road) {
  const name = road?.name?.trim();
  const reference = road?.ref?.trim();

  if (name && reference) {
    return `${name} · ${reference}`;
  }

  return name || reference || 'Unnamed road';
}

function classifyTurn(delta) {
  const magnitude = Math.abs(delta);
  const side = delta < 0 ? 'left' : 'right';

  if (magnitude < STRAIGHT_THRESHOLD_DEGREES) {
    return {
      type: 'continue',
      modifier: 'straight'
    };
  }

  if (magnitude < SLIGHT_THRESHOLD_DEGREES) {
    return {
      type: `slight-${side}`,
      modifier: side
    };
  }

  if (magnitude < TURN_THRESHOLD_DEGREES) {
    return {
      type: `turn-${side}`,
      modifier: side
    };
  }

  return {
    type: `sharp-${side}`,
    modifier: side
  };
}

function laneGuidance(turnLanes, modifier) {
  if (!turnLanes?.trim()) {
    return [];
  }

  const desired = modifier === 'left'
    ? ['left']
    : modifier === 'right'
      ? ['right']
      : ['through', 'straight'];

  return turnLanes.split('|').map(rawLane => {
    const indications = rawLane
      .split(';')
      .map(value => value.trim())
      .filter(Boolean);

    const normalized = indications.length
      ? indications
      : ['straight'];

    return {
      indication: normalized[0],
      indications: normalized,
      recommended: normalized.some(indication =>
        desired.some(value =>
          indication.includes(value)
        )
      )
    };
  });
}

function turnInstruction(
  maneuver,
  road
) {
  const label = roadLabel(road);
  const destination =
    road?.destination?.trim();

  if (road?.link) {
    const side = maneuver.modifier === 'left'
      ? 'left'
      : maneuver.modifier === 'right'
        ? 'right'
        : '';

    const direction = side
      ? ` on the ${side}`
      : '';

    const toward = destination
      ? ` toward ${destination}`
      : label === 'Unnamed road'
        ? ''
        : ` onto ${label}`;

    return `Take the ramp${direction}${toward}`;
  }

  const verb = {
    continue: 'Continue',
    'slight-left': 'Keep left',
    'slight-right': 'Keep right',
    'turn-left': 'Turn left',
    'turn-right': 'Turn right',
    'sharp-left': 'Make a sharp left',
    'sharp-right': 'Make a sharp right'
  }[maneuver.type] ?? 'Continue';

  return `${verb} onto ${label}`;
}

function ordinal(value) {
  const remainder100 = value % 100;

  if (
    remainder100 >= 11 &&
    remainder100 <= 13
  ) {
    return `${value}th`;
  }

  const suffix = {
    1: 'st',
    2: 'nd',
    3: 'rd'
  }[value % 10] ?? 'th';

  return `${value}${suffix}`;
}

function countRoundaboutExits(
  graph,
  legs,
  firstRoundabout,
  lastRoundabout
) {
  let exits = 0;

  for (
    let index = firstRoundabout;
    index <= lastRoundabout;
    index += 1
  ) {
    const leg = legs[index];
    const options = new Set();

    for (
      const edge of graph.outgoingEdges(
        leg.toNode
      )
    ) {
      const road = graph.road(edge.road);

      if (
        road.roundabout ||
        !graph.isTurnAllowed(
          leg.toNode,
          leg.roadIndex,
          edge.road
        )
      ) {
        continue;
      }

      options.add(`${edge.to}:${edge.road}`);
    }

    exits += options.size;
  }

  return Math.max(1, exits);
}

function withSpacing(maneuvers) {
  return maneuvers.map(
    (maneuver, index) => ({
      ...maneuver,
      id: `maneuver-${index}`,
      distanceToNextMeters:
        index + 1 < maneuvers.length
          ? Math.max(
              0,
              maneuvers[index + 1]
                .routeDistanceMeters -
              maneuver.routeDistanceMeters
            )
          : 0
    })
  );
}

export class ManeuverGenerator {
  generate({
    graph,
    route,
    destination = null
  }) {
    const points = route?.points ?? [];
    const legs = route?.legs ?? [];

    if (!graph || !points.length) {
      throw new TypeError(
        'Maneuver generation requires a graph route.'
      );
    }

    if (!legs.length) {
      return withSpacing([{
        type: 'arrive',
        modifier: 'straight',
        instruction: 'You have arrived',
        roadName: '',
        roadRef: '',
        location: points[0],
        routePointIndex: 0,
        routeDistanceMeters: 0
      }]);
    }

    const firstRoad = legs[0].road;
    const firstBearing = bearingFromLeg(
      points,
      legs[0],
      false
    );

    const maneuvers = [{
      type: 'depart',
      modifier: 'straight',
      instruction:
        `Head ${cardinalDirection(firstBearing)} on ${roadLabel(firstRoad)}`,
      roadName: firstRoad.name,
      roadRef: firstRoad.ref,
      destination: firstRoad.destination,
      bearingAfter: firstBearing,
      location: points[0],
      routePointIndex: 0,
      routeDistanceMeters: 0
    }];

    for (
      let index = 1;
      index < legs.length;
      index += 1
    ) {
      const incoming = legs[index - 1];
      const outgoing = legs[index];

      if (outgoing.road.roundabout) {
        if (incoming.road.roundabout) {
          continue;
        }

        let lastRoundabout = index;

        while (
          lastRoundabout + 1 < legs.length &&
          legs[lastRoundabout + 1]
            .road.roundabout
        ) {
          lastRoundabout += 1;
        }

        const exitLeg =
          legs[lastRoundabout + 1] ?? null;

        const exitNumber =
          countRoundaboutExits(
            graph,
            legs,
            index,
            lastRoundabout
          );

        const exitRoad =
          exitLeg?.road ?? outgoing.road;

        maneuvers.push({
          type: 'roundabout',
          modifier: 'right',
          exitNumber,
          instruction:
            `At the roundabout, take the ${ordinal(exitNumber)} exit onto ${roadLabel(exitRoad)}`,
          roadName: exitRoad.name,
          roadRef: exitRoad.ref,
          destination: exitRoad.destination,
          location:
            points[outgoing.pointStartIndex],
          routePointIndex:
            outgoing.pointStartIndex,
          routeDistanceMeters:
            outgoing.routeDistanceStartMeters
        });

        index = lastRoundabout + 1;
        continue;
      }

      if (
        incoming.road.roundabout ||
        sameRoad(incoming.road, outgoing.road)
      ) {
        continue;
      }

      const incomingBearing =
        bearingFromLeg(points, incoming, true);

      const outgoingBearing =
        bearingFromLeg(points, outgoing, false);

      const delta = normalizedTurnDelta(
        incomingBearing,
        outgoingBearing
      );

      const classified = classifyTurn(delta);

      if (
        classified.type === 'continue' &&
        roadLabel(outgoing.road) ===
          'Unnamed road'
      ) {
        continue;
      }

      const maneuver = {
        ...classified,
        instruction: '',
        roadName: outgoing.road.name,
        roadRef: outgoing.road.ref,
        destination:
          outgoing.road.destination,
        bearingBefore: incomingBearing,
        bearingAfter: outgoingBearing,
        turnAngleDegrees: delta,
        location:
          points[outgoing.pointStartIndex],
        routePointIndex:
          outgoing.pointStartIndex,
        routeDistanceMeters:
          outgoing.routeDistanceStartMeters
      };

      const lanes = laneGuidance(
        incoming.road.turnLanes,
        maneuver.modifier
      );

      if (lanes.length > 1) {
        maneuver.lanes = lanes;
      }

      maneuver.instruction =
        turnInstruction(
          maneuver,
          outgoing.road
        );

      maneuvers.push(maneuver);
    }

    const arrivalPoint =
      points[points.length - 1];

    maneuvers.push({
      type: 'arrive',
      modifier: 'straight',
      instruction: destination?.name
        ? `Arrive at ${destination.name}`
        : 'You have arrived',
      roadName: '',
      roadRef: '',
      location: arrivalPoint,
      routePointIndex: points.length - 1,
      routeDistanceMeters:
        route.distanceMeters
    });

    return withSpacing(maneuvers);
  }
}
