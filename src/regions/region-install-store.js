const STORAGE_KEY =
  'roam.installedRegions.v2';

const LEGACY_STORAGE_KEY =
  'roam.installedRegions.v1';

export class RegionInstallStore {
  constructor({
    storage = globalThis.localStorage,
    now = () => new Date()
  } = {}) {
    this.storage = storage;
    this.now = now;
  }

  load() {
    const current = this.#read(STORAGE_KEY);

    if (current) {
      return current
        .map(normalizeRecord)
        .filter(Boolean);
    }

    const legacy =
      this.#read(LEGACY_STORAGE_KEY) ?? [];

    return legacy
      .map(normalizeRecord)
      .filter(Boolean);
  }

  save(regions) {
    this.storage?.setItem(
      STORAGE_KEY,
      JSON.stringify(
        regions
          .map(normalizeRecord)
          .filter(Boolean)
      )
    );
  }

  get(id) {
    return this.load().find(
      region => region.id === id
    ) ?? null;
  }

  isInstalled(id, version = undefined) {
    const installed = this.get(id);

    if (!installed) {
      return false;
    }

    if (version === undefined) {
      return true;
    }

    return versionsMatch(
      installed.version,
      version
    );
  }

  install(region, details = {}) {
    if (!region?.id) {
      throw new TypeError(
        'RegionInstallStore.install requires a region.'
      );
    }

    const regions = this.load();
    const previous = regions.find(
      installed => installed.id === region.id
    );

    const timestamp =
      this.now().toISOString();

    const record = normalizeRecord({
      ...previous,
      ...details,
      id: region.id,
      name: region.name,
      country: region.country,
      version: region.version ?? 1,
      installedAt:
        previous?.installedAt ?? timestamp,
      updatedAt: timestamp
    });

    this.save([
      ...regions.filter(
        installed => installed.id !== region.id
      ),
      record
    ]);

    return record;
  }

  remove(id) {
    const record = this.get(id);

    this.save(
      this.load().filter(
        region => region.id !== id
      )
    );

    return record;
  }

  #read(key) {
    try {
      const value = JSON.parse(
        this.storage?.getItem(key)
      );

      return Array.isArray(value)
        ? value
        : null;
    } catch {
      return null;
    }
  }
}

export function versionsMatch(left, right) {
  return String(left ?? '') ===
    String(right ?? '');
}

function normalizeRecord(record) {
  if (!record?.id) {
    return null;
  }

  return {
    id: String(record.id),
    name: String(
      record.name ?? record.id
    ),
    country: String(
      record.country ?? ''
    ),
    version:
      record.version ?? null,
    installedAt:
      record.installedAt ?? null,
    updatedAt:
      record.updatedAt ??
      record.installedAt ?? null,
    sizeBytes:
      finiteNonNegative(
        record.sizeBytes
      ),
    fileCount:
      finiteNonNegative(
        record.fileCount
      ),
    cacheName:
      typeof record.cacheName === 'string'
        ? record.cacheName
        : null,
    verifiedFiles:
      finiteNonNegative(
        record.verifiedFiles
      )
  };
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
