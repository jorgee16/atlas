export class TransitProviderRegistry {
  constructor({ catalog = null, catalogProvider = null, providers = {} } = {}) {
    if (!catalog?.findByPosition && typeof catalogProvider !== 'function') {
      throw new TypeError('TransitProviderRegistry requires a region catalog.');
    }

    this.catalog = catalog;
    this.catalogProvider = catalogProvider;
    this.providers = new Map();

    for (const [regionId, provider] of Object.entries(providers)) {
      this.register(regionId, provider);
    }
  }

  register(regionId, provider) {
    if (!regionId || !provider?.bridge) {
      throw new TypeError('Transit provider registration requires a region id and bridge.');
    }

    this.providers.set(regionId, {
      id: provider.id ?? regionId,
      label: provider.label ?? 'Public transport',
      bridge: provider.bridge
    });

    return this;
  }

  async resolve(origin, destination) {
    const originRegion = await this.#regionFor(origin);
    const destinationRegion = await this.#regionFor(destination);

    if (!originRegion) {
      return {
        available: false,
        region: null,
        provider: null,
        reason: 'Public transport routing isn’t available in this region yet.'
      };
    }

    if (!destinationRegion || destinationRegion.id !== originRegion.id) {
      return {
        available: false,
        region: originRegion,
        provider: null,
        reason: 'Public transport routing isn’t available for this cross-region journey.'
      };
    }

    const provider = this.providers.get(originRegion.id) ?? null;

    if (!provider) {
      return {
        available: false,
        region: originRegion,
        provider: null,
        reason: 'Public transport routing isn’t available in this region yet.'
      };
    }

    return {
      available: true,
      region: originRegion,
      provider,
      reason: null
    };
  }

  async #regionFor(point) {
    if (!point) return null;

    try {
      const catalog = this.catalog ?? this.catalogProvider?.();
      return await catalog?.findByPosition(point) ?? null;
    } catch {
      return null;
    }
  }
}
