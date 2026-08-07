const STORAGE_KEY =
  'roam.installedRegions.v1';

export class RegionInstallStore {
  load() {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_KEY)
      ) ?? [];
    } catch {
      return [];
    }
  }

  save(regions) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(regions)
    );
  }

  isInstalled(id) {
    return this.load()
      .some(region => region.id === id);
  }

  install(region) {
    const regions = this.load();

    if (
      regions.some(
        installed =>
          installed.id === region.id
      )
    ) {
      return;
    }

    regions.push({
      id: region.id,
      name: region.name,
      installedAt:
        new Date().toISOString()
    });

    this.save(regions);
  }

  remove(id) {
    this.save(
      this.load().filter(
        region => region.id !== id
      )
    );
  }
}
