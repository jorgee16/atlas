function geometryPoints(geometry) {
  if (geometry == null) return [];

  // Atlas Transit currently returns TfL geometry as a JSON string of
  // [lat, lon] coordinate pairs, for example:
  // "[[51.5010,-0.1246],[51.5013,-0.1249]]".
  // Accept an already-decoded array too so the bridge is not coupled to
  // the transport service serialisation detail.
  let coordinates = geometry;
  if (typeof geometry === 'string') {
    const text = geometry.trim();

    if (text.startsWith('[')) {
      try {
        coordinates = JSON.parse(text);
      } catch {
        coordinates = null;
      }
    } else {
      // Keep compatibility with WKT LINESTRING(lon lat, ...).
      const match = text.match(/^LINESTRING\s*\((.*)\)$/i);
      if (!match) return [];
      return match[1]
        .split(',')
        .map(pair => {
          const [lon, lat] = pair.trim().split(/\s+/).map(Number);
          return { lat, lon };
        })
        .filter(validPoint);
    }
  }

  if (!Array.isArray(coordinates)) return [];

  return coordinates
    .map(pair => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const lat = Number(pair[0]);
      const lon = Number(pair[1]);
      return { lat, lon };
    })
    .filter(validPoint);
}

function validPoint(point) {
  return point != null &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 && point.lat <= 90 &&
    point.lon >= -180 && point.lon <= 180;
}

export class TransitJourneyBridge {
  constructor({ provider }) {
    if (!provider?.journeys) throw new TypeError('TransitJourneyBridge requires a journey provider.');
    this.provider = provider;
  }

  async plan(origin, destination, options = {}) {
    const journeys = await this.provider.journeys(origin, destination, options);
    return journeys.map(journey => ({
      ...journey,
      origin: { ...origin },
      destination: { ...destination },
      sequence: journey.legs.map((leg, index) => this.#step(leg, index))
    }));
  }

  #step(leg, index) {
    const points = geometryPoints(leg.geometry);

    if (!points.length) {
      throw new Error(
        `TfL geometry unsupported: ${String(leg.geometry).slice(0, 200)}`
      );
    }
    const isWalking = leg.mode === 'walking';
    return {
      index,
      kind: isWalking ? 'walk' : 'transit',
      mode: leg.mode,
      line: leg.line,
      fromName: leg.fromName,
      toName: leg.toName,
      durationMinutes: leg.durationMinutes,
      departureTime: leg.departureTime,
      arrivalTime: leg.arrivalTime,
      instruction: leg.instruction,
      direction: leg.direction,
      departureStopId: leg.departureStopId,
      arrivalStopId: leg.arrivalStopId,
      intermediateStops: leg.intermediateStops,
      disruptions: leg.disruptions,
      points,
      start: points[0] ?? null,
      end: points.at(-1) ?? null,
      navigation: isWalking ? 'atlas-offline' : 'provider-guidance'
    };
  }
}

export { geometryPoints };
