import { JourneyProvider } from './journey-provider.js';

export class TfLJourneyProvider extends JourneyProvider {
  constructor({ baseUrl = '/transit-api', fetchImpl = globalThis.fetch } = {}) {
    super();
    if (typeof fetchImpl !== 'function') throw new TypeError('TfLJourneyProvider requires fetch.');
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    // Atlas V3.1 bound fetch: Android Chrome can reject a detached native fetch.
    this.fetch = fetchImpl === globalThis.fetch
      ? globalThis.fetch.bind(globalThis)
      : fetchImpl;
  }

  async journeys(origin, destination, options = {}) {
    this.#point(origin, 'origin');
    this.#point(destination, 'destination');
    const query = new URLSearchParams({
      from: `${origin.lat},${origin.lon}`,
      to: `${destination.lat},${destination.lon}`,
      from_name: origin.name ?? 'Origin',
      to_name: destination.name ?? 'Destination',
      time_is: options.timeIs ?? 'departing',
      mode: options.mode ?? 'bus,tube,dlr,overground,elizabeth-line,national-rail,tram',
      realtime: options.realtime === false ? 'false' : 'true'
    });
    if (options.date) query.set('date', options.date);
    if (options.time) query.set('time', options.time);

    const response = await this.fetch(`${this.baseUrl}/api/v2/journeys?${query}`, {
      signal: options.signal
    });
    if (!response.ok) throw new Error(`Transit provider failed (${response.status}).`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Transit provider returned an invalid journey payload.');
    return rows.map((row, index) => this.#journey(row, index));
  }

  #journey(row, index) {
    return {
      id: `tfl-${index}-${row.start_time ?? 'now'}`,
      provider: 'tfl',
      durationMinutes: Number(row.duration_minutes ?? 0),
      startTime: row.start_time ?? null,
      arrivalTime: row.arrival_time ?? null,
      legs: (row.legs ?? []).map((leg, legIndex) => ({
        id: `leg-${legIndex}`,
        mode: leg.mode ?? 'unknown',
        line: leg.line ?? null,
        fromName: leg.from_name ?? '',
        toName: leg.to_name ?? '',
        durationMinutes: Number(leg.duration_minutes ?? 0),
        departureTime: leg.departure_time ?? null,
        arrivalTime: leg.arrival_time ?? null,
        instruction: leg.instruction ?? null,
        direction: leg.direction ?? null,
        distanceMeters: leg.distance_m == null ? null : Number(leg.distance_m),
        departureStopId: leg.departure_stop_id ?? null,
        arrivalStopId: leg.arrival_stop_id ?? null,
        intermediateStops: [...(leg.intermediate_stops ?? [])],
        geometry: leg.geometry ?? null,
        disruptions: [...(leg.disruptions ?? [])]
      }))
    };
  }

  #point(point, label) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) {
      throw new TypeError(`Transit ${label} requires lat and lon.`);
    }
  }
}
