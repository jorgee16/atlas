const DEFAULT_TRIP_CATALOG =
  'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev/trips/catalog.json';

export class TripCatalog {
  constructor({
    url = DEFAULT_TRIP_CATALOG,
    fetchFn = globalThis.fetch.bind(globalThis)
  } = {}) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  async list() {
    const response = await this.fetchFn(
      this.url,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error(
        `Could not load trip catalog: ${response.status}`
      );
    }

    const document = await response.json();

    if (
      document?.version !== 1 ||
      !Array.isArray(document.trips)
    ) {
      throw new Error(
        'Trip catalog has an unsupported format.'
      );
    }

    return document.trips
      .filter(trip =>
        typeof trip?.id === 'string' &&
        typeof trip?.name === 'string' &&
        typeof trip?.url === 'string'
      )
      .map(trip => ({
        ...trip,
        url: new URL(
          trip.url,
          this.url
        ).href
      }));
  }
}
