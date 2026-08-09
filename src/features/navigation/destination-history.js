const STORAGE_KEY = 'atlas.navigation.recent-destinations.v1';
const MAX_RECENT_DESTINATIONS = 6;

export class DestinationHistory {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
  }

  list() {
    try {
      const value = JSON.parse(
        this.storage?.getItem(STORAGE_KEY) ?? '[]'
      );

      return Array.isArray(value)
        ? value.filter(this.#isPoint).slice(0, MAX_RECENT_DESTINATIONS)
        : [];
    } catch {
      return [];
    }
  }

  add(destination) {
    if (!this.#isPoint(destination)) return;

    const recent = this.list().filter(
      item => String(item.id) !== String(destination.id) &&
        !(
          item.lat === destination.lat &&
          item.lon === destination.lon
        )
    );

    recent.unshift({
      id: destination.id ?? `${destination.lat}:${destination.lon}`,
      name: destination.name ?? 'Destination',
      lat: destination.lat,
      lon: destination.lon,
      amenity: destination.amenity ?? 'place',
      type: destination.type ?? 'place',
      address: destination.address ?? '',
      city: destination.city ?? ''
    });

    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify(recent.slice(0, MAX_RECENT_DESTINATIONS))
      );
    } catch {
      // Navigation must remain usable when storage is unavailable.
    }
  }

  clear() {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore private-mode and quota failures.
    }
  }

  #isPoint(value) {
    return Boolean(
      value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lon)
    );
  }
}
