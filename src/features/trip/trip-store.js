function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeSourceName(value) {
  return String(value ?? 'trip.json').trim() || 'trip.json';
}

function normalizeTripId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
}

function makeId(sourceName, data) {
  const canonicalId = normalizeTripId(data?.trip?.id);
  if (canonicalId) return `trip:${canonicalId}`;

  const base = normalizeSourceName(sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  const name = normalizeTripId(
    data?.trip?.name ?? data?.trip?.title ?? ''
  );
  return `file:${base}:${name}`;
}

function sameCanonicalTrip(record, data) {
  const incoming = normalizeTripId(data?.trip?.id);
  if (!incoming) return false;
  return normalizeTripId(record?.data?.trip?.id) === incoming;
}

function isTripRecord(record) {
  return Boolean(
    record &&
    typeof record.id === 'string' &&
    typeof record.sourceName === 'string' &&
    record.data &&
    typeof record.data === 'object' &&
    record.data.trip &&
    typeof record.data.trip === 'object'
  );
}

export class TripStore {
  constructor({
    storage = globalThis.localStorage,
    key = 'roam.trips.v1'
  } = {}) {
    this.storage = storage;
    this.key = key;
  }

  load() {
    const raw = this.storage?.getItem?.(this.key);
    if (!raw) {
      return { activeId: null, trips: [] };
    }

    const parsed = safeParse(raw);
    const trips = Array.isArray(parsed?.trips)
      ? parsed.trips.filter(isTripRecord)
      : [];
    const activeId = trips.some(trip => trip.id === parsed?.activeId)
      ? parsed.activeId
      : trips[0]?.id ?? null;

    return { activeId, trips };
  }

  save(state) {
    const trips = Array.isArray(state?.trips)
      ? state.trips.filter(isTripRecord)
      : [];
    const activeId = trips.some(trip => trip.id === state?.activeId)
      ? state.activeId
      : trips[0]?.id ?? null;

    this.storage?.setItem?.(
      this.key,
      JSON.stringify({ version: 1, activeId, trips })
    );

    return { activeId, trips };
  }

  upsert(data, { sourceName = 'trip.json' } = {}) {
    const state = this.load();
    const id = makeId(sourceName, data);
    const record = {
      id,
      sourceName: normalizeSourceName(sourceName),
      name: data?.trip?.name ?? data?.trip?.title ?? normalizeSourceName(sourceName).replace(/\.json$/i, ''),
      importedAt: Date.now(),
      data
    };

    const existingIndex = state.trips.findIndex(trip =>
      trip.id === id || sameCanonicalTrip(trip, data)
    );

    if (existingIndex >= 0) {
      record.viewState =
        state.trips[existingIndex].viewState ?? null;

      state.trips[existingIndex] = record;
      // Drop any stale duplicate records created by older filename-based
      // identity rules for the same canonical trip.
      state.trips = state.trips.filter((trip, index) =>
        index === existingIndex || !sameCanonicalTrip(trip, data)
      );
    } else {
      state.trips.unshift(record);
    }

    state.activeId = id;
    this.save(state);
    return record;
  }

  setActive(id) {
    const state = this.load();
    if (!state.trips.some(trip => trip.id === id)) return null;
    state.activeId = id;
    this.save(state);
    return state.trips.find(trip => trip.id === id) ?? null;
  }

  setViewState(id, viewState) {
    const state = this.load();

    const record =
      state.trips.find(trip => trip.id === id);

    if (!record) {
      return null;
    }

    const day =
      viewState?.day != null
        ? String(viewState.day)
        : null;

    const stopIndex =
      Number.isInteger(viewState?.stopIndex) &&
      viewState.stopIndex >= 0
        ? viewState.stopIndex
        : null;

    const mode =
      viewState?.mode === 'map'
        ? 'map'
        : 'schedule';

    record.viewState = {
      day,
      stopIndex,
      mode
    };

    this.save(state);

    return record.viewState;
  }

  remove(id) {
    const state = this.load();
    state.trips = state.trips.filter(trip => trip.id !== id);
    if (state.activeId === id) state.activeId = state.trips[0]?.id ?? null;
    return this.save(state);
  }

  clear() {
    this.storage?.removeItem?.(this.key);
  }
}
