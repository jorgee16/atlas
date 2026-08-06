export class RegionRepository {
  constructor({
    indexUrl = `${import.meta.env.BASE_URL}regions/index.json`,
    fetchFn = globalThis.fetch.bind(globalThis)
  } = {}) {
    this.indexUrl = indexUrl;
    this.fetchFn = fetchFn;
    this.regions = null;
  }

  async list() {
    if (this.regions) {
      return this.regions;
    }

    const response = await this.fetchFn(this.indexUrl, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        `Unable to load region catalogue: HTTP ${response.status}`
      );
    }

    const document = await response.json();
    this.regions = document.regions ?? [];

    return this.regions;
  }

  async findByPosition(position) {
    this.#validatePosition(position);

    const regions = await this.list();

    return regions.find(region => {
      const [left, bottom, right, top] = region.bounds;

      return (
        position.lon >= left &&
        position.lon <= right &&
        position.lat >= bottom &&
        position.lat <= top
      );
    }) ?? null;
  }

  #validatePosition(position) {
    if (
      !Number.isFinite(position?.lat) ||
      !Number.isFinite(position?.lon)
    ) {
      throw new TypeError(
        'Region lookup requires valid latitude and longitude.'
      );
    }
  }
}
