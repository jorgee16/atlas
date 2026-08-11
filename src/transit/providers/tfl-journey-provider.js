import {
  Capacitor,
  CapacitorHttp
} from '@capacitor/core';

import {
  JourneyProvider
} from './journey-provider.js';

const TFL_BASE_URL =
  'https://api.tfl.gov.uk';

function normalizeMode(value) {
  const aliases = {
    bus: 'public-bus',
    'national-rail': 'train'
  };

  return String(value ?? '')
    .split(',')
    .map(mode => mode.trim())
    .filter(Boolean)
    .map(mode => aliases[mode] ?? mode)
    .join(',');
}

function disruption(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    category: item.category ?? null,
    type: item.type ?? null,
    description: item.description ?? null,
    summary: item.summary ?? null
  };
}

export class TfLJourneyProvider extends JourneyProvider {
  constructor({
    baseUrl = TFL_BASE_URL,
    fetchImpl = globalThis.fetch,
    appKey = ''
  } = {}) {
    super();

    if (typeof fetchImpl !== 'function') {
      throw new TypeError(
        'TfLJourneyProvider requires fetch.'
      );
    }

    this.baseUrl =
      String(baseUrl).replace(/\/$/, '');

    this.fetch =
      fetchImpl === globalThis.fetch
        ? globalThis.fetch.bind(globalThis)
        : fetchImpl;

    this.customFetch =
      fetchImpl !== globalThis.fetch;

    this.appKey =
      String(appKey ?? '').trim();
  }

  async journeys(
    origin,
    destination,
    options = {}
  ) {
    this.#point(origin, 'origin');
    this.#point(destination, 'destination');

    const from =
      `${origin.lat},${origin.lon}`;

    const to =
      `${destination.lat},${destination.lon}`;

    const endpoint =
      `${this.baseUrl}` +
      `/Journey/JourneyResults/` +
      `${encodeURIComponent(from)}/to/` +
      `${encodeURIComponent(to)}`;

    const params = {
      timeIs:
        options.timeIs ?? 'departing',

      mode:
        normalizeMode(
          options.mode ??
          [
            'bus',
            'tube',
            'dlr',
            'overground',
            'elizabeth-line',
            'national-rail',
            'tram'
          ].join(',')
        ),

      fromName:
        origin.name ?? 'Origin',

      toName:
        destination.name ?? 'Destination',

      useRealTimeLiveArrivals:
        options.realtime === false
          ? 'false'
          : 'true'
    };

    if (options.date) {
      params.date = options.date;
    }

    if (options.time) {
      params.time = options.time;
    }

    if (options.preference) {
      params.journeyPreference =
        options.preference;
    }

    if (options.accessibility) {
      params.accessibilityPreference =
        options.accessibility;
    }

    if (options.walkingSpeed) {
      params.walkingSpeed =
        options.walkingSpeed;
    }

    if (
      Number.isFinite(
        options.maxWalkingMinutes
      )
    ) {
      params.maxWalkingMinutes =
        String(
          options.maxWalkingMinutes
        );
    }

    if (this.appKey) {
      params.app_key = this.appKey;
    }

    const payload =
      await this.#request(
        endpoint,
        params,
        options.signal
      );

    const rows =
      Array.isArray(payload?.journeys)
        ? payload.journeys
        : [];

    return rows.map(
      (row, index) =>
        this.#journey(
          row,
          index
        )
    );
  }

  async #request(
    endpoint,
    params,
    signal
  ) {
    /*
     * Tests can continue injecting fetchImpl.
     * Browser development also uses standard fetch.
     */
    if (
      this.customFetch ||
      !Capacitor.isNativePlatform()
    ) {
      const query =
        new URLSearchParams(params);

      const response =
        await this.fetch(
          `${endpoint}?${query}`,
          { signal }
        );

      if (!response.ok) {
        throw new Error(
          `TfL journey request failed (${response.status}).`
        );
      }

      return response.json();
    }

    /*
     * Android/iOS:
     * make the TfL call using the native HTTP
     * implementation rather than WebView fetch.
     */
    const response =
      await CapacitorHttp.get({
        url: endpoint,
        params,
        connectTimeout: 15000,
        readTimeout: 30000
      });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      throw new Error(
        `TfL journey request failed (${response.status}).`
      );
    }

    if (
      typeof response.data === 'string'
    ) {
      try {
        return JSON.parse(
          response.data
        );
      } catch {
        throw new Error(
          'TfL returned invalid JSON.'
        );
      }
    }

    return response.data;
  }

  #journey(row, index) {
    const rawLegs =
      Array.isArray(row?.legs)
        ? row.legs
        : [];

    const legs =
      rawLegs.map(
        (leg, legIndex) =>
          this.#leg(
            leg,
            legIndex
          )
      );

    const calculatedDuration =
      legs.reduce(
        (total, leg) =>
          total +
          leg.durationMinutes,
        0
      );

    return {
      id:
        `tfl-${index}-` +
        `${row?.startDateTime ?? 'now'}`,

      provider: 'tfl',

      durationMinutes:
        Number(
          row?.duration ??
          calculatedDuration
        ),

      startTime:
        row?.startDateTime ?? null,

      arrivalTime:
        row?.arrivalDateTime ?? null,

      legs
    };
  }

  #leg(leg, legIndex) {
    const mode =
      leg?.mode ?? {};

    const routeOptions =
      Array.isArray(leg?.routeOptions)
        ? leg.routeOptions
        : [];

    const firstRoute =
      routeOptions[0] ?? {};

    const instruction =
      leg?.instruction ?? {};

    const departure =
      leg?.departurePoint ?? {};

    const arrival =
      leg?.arrivalPoint ?? {};

    const path =
      leg?.path ?? {};

    const directions =
      Array.isArray(
        firstRoute?.directions
      )
        ? firstRoute.directions
        : [];

    const stopPoints =
      Array.isArray(path?.stopPoints)
        ? path.stopPoints
        : [];

    const intermediateStops =
      stopPoints
        .map(stop =>
          String(
            stop?.name ??
            stop?.commonName ??
            ''
          )
        )
        .filter(Boolean);

    const disruptions =
      (
        Array.isArray(
          leg?.disruptions
        )
          ? leg.disruptions
          : []
      )
        .map(disruption)
        .filter(Boolean);

    return {
      id:
        `leg-${legIndex}`,

      mode:
        String(
          mode?.id ??
          mode?.name ??
          'unknown'
        ),

      line:
        firstRoute?.name ?? null,

      fromName:
        String(
          departure?.commonName ??
          ''
        ),

      toName:
        String(
          arrival?.commonName ??
          ''
        ),

      durationMinutes:
        Number(
          leg?.duration ?? 0
        ),

      departureTime:
        leg?.departureTime ?? null,

      arrivalTime:
        leg?.arrivalTime ?? null,

      instruction:
        instruction?.summary ??
        instruction?.detailed ??
        null,

      direction:
        directions.length
          ? String(directions[0])
          : null,

      distanceMeters:
        leg?.distance == null
          ? null
          : Number(leg.distance),

      departureStopId:
        departure?.naptanId ??
        departure?.id ??
        null,

      arrivalStopId:
        arrival?.naptanId ??
        arrival?.id ??
        null,

      intermediateStops,

      stopCount:
        intermediateStops.length
          ? intermediateStops.length
          : null,

      geometry:
        path?.lineString ?? null,

      disruptions
    };
  }

  #point(point, label) {
    if (
      !Number.isFinite(point?.lat) ||
      !Number.isFinite(point?.lon)
    ) {
      throw new TypeError(
        `Transit ${label} requires lat and lon.`
      );
    }
  }
}
