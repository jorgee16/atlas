function tariffForVehicle(event, vehicleClass = 1) {
  const tariffs = event?.tariffs ?? {};
  const direct = Number(tariffs[String(vehicleClass)]);
  if (Number.isFinite(direct)) return direct;

  const classOne = Number(tariffs['1']);
  return Number.isFinite(classOne) ? classOne : 0;
}

export class TollEventIndex {
  constructor(document = null) {
    this.version = Number(document?.version) || 0;
    this.datasetVersion = document?.datasetVersion ?? null;
    this.partitionId = document?.partitionId ?? null;
    this.eventsByEdge = new Map();

    for (const entry of document?.edges ?? []) {
      if (!Number.isInteger(entry?.edgeIndex) || entry.edgeIndex < 0) {
        continue;
      }

      const events = Array.isArray(entry.events)
        ? entry.events.filter(event => event?.id)
        : [];

      if (events.length) {
        this.eventsByEdge.set(entry.edgeIndex, events);
      }
    }
  }

  get available() {
    return this.eventsByEdge.size > 0;
  }

  eventsForEdge(edgeIndex) {
    return this.eventsByEdge.get(edgeIndex) ?? [];
  }

  edgeHasCharge(edgeIndex, vehicleClass = 1) {
    return this.eventsForEdge(edgeIndex).some(
      event => tariffForVehicle(event, vehicleClass) > 0
    );
  }

  edgeChargeEuros(edgeIndex, vehicleClass = 1) {
    return this.eventsForEdge(edgeIndex).reduce(
      (total, event) => total + tariffForVehicle(event, vehicleClass),
      0
    );
  }

  routeCharges(edgeIndexes, vehicleClass = 1) {
    const seen = new Set();
    const charges = [];

    for (const edgeIndex of edgeIndexes ?? []) {
      for (const event of this.eventsForEdge(edgeIndex)) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);

        const euros = tariffForVehicle(event, vehicleClass);
        if (euros <= 0) continue;

        charges.push({
          id: event.id,
          roadRef: event.roadRef ?? '',
          system: event.system ?? null,
          operator: event.operator ?? null,
          euros,
          edgeIndex
        });
      }
    }

    return charges;
  }
}
