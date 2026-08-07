export class RegionCatalog {
  constructor({
    url =
      `${import.meta.env.BASE_URL}regions/catalog.json`,
    fetchFn = null
  } = {}) {
    this.url = url;

    this.fetchFn =
      fetchFn ??
      ((...args) => window.fetch(...args));

    this.regions = null;
  }

  async list() {
    if (this.regions) {
      return this.regions;
    }

    const response =
      await this.fetchFn(this.url);

    if (!response.ok) {
      throw new Error(
        `Unable to load region catalogue: HTTP ${response.status}`
      );
    }

    const document =
      await response.json();

    this.regions =
      document.regions ?? [];

    return this.regions;
  }

  async findByPosition({
    lat,
    lon,
    latitude,
    longitude
  }) {
    const resolvedLat =
      lat ?? latitude;

    const resolvedLon =
      lon ?? longitude;

    if (
      !Number.isFinite(resolvedLat) ||
      !Number.isFinite(resolvedLon)
    ) {
      throw new TypeError(
        'RegionCatalog requires a valid position.'
      );
    }

    const regions =
      await this.list();

    return (
      regions.find(region =>
        positionInRegion(
          region,
          {
            lat: resolvedLat,
            lon: resolvedLon
          }
        )
      ) ?? null
    );
  }
}

export function positionInRegion(
  region,
  position
) {
  const areas =
    Array.isArray(region?.areas) &&
    region.areas.length
      ? region.areas
      : [region?.bounds];

  return areas.some(bounds => {
    if (
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite)
    ) {
      return false;
    }

    const [
      left,
      bottom,
      right,
      top
    ] = bounds;

    return (
      position.lon >= left &&
      position.lon <= right &&
      position.lat >= bottom &&
      position.lat <= top
    );
  });
}
