const CACHE_NAME =
  'roam-regions-v1';

export class RegionDownloader {
  constructor({
    fetchFn = null
  } = {}) {
    this.fetchFn =
      fetchFn ??
      ((...args) => window.fetch(...args));
  }

  async download(
    region,
    {
      onProgress = () => {}
    } = {}
  ) {
    const assets = region.assets ?? {};

    const urls = [
      assets.pois,
      assets.index,
      assets.map
    ].filter(Boolean);

    if (!urls.length) {
      throw new Error(
        `${region.name} does not define downloadable assets.`
      );
    }

    const cache =
      await caches.open(CACHE_NAME);

    let completed = 0;

    for (const url of urls) {
      const response =
        await this.fetchFn(
          this.#resolveUrl(url),
          {
            cache: 'no-store'
          }
        );

      if (!response.ok) {
        throw new Error(
          `Unable to download ${region.name}: ${url}`
        );
      }

      await cache.put(
        this.#resolveUrl(url),
        response.clone()
      );

      completed += 1;

      onProgress({
        completed,
        total: urls.length,
        region
      });
    }

    return true;
  }

  async remove(region) {
    const cache =
      await caches.open(CACHE_NAME);

    const assets = region.assets ?? {};

    const urls = [
      assets.pois,
      assets.index,
      assets.map
    ].filter(Boolean);

    await Promise.all(
      urls.map(url =>
        cache.delete(
          this.#resolveUrl(url)
        )
      )
    );
  }

  #resolveUrl(url) {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const relativeUrl =
      String(url).replace(/^\//, '');

    return new URL(
      `${import.meta.env.BASE_URL}${relativeUrl}`,
      window.location.origin
    ).href;
  }
}
