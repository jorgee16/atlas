const CACHE_PREFIX =
  'roam-region-v2-';

const LEGACY_CACHE_NAME =
  'roam-regions-v1';

export class RegionDownloader {
  constructor({
    fetchFn = null,
    cacheStorage = globalThis.caches,
    cryptoRef = globalThis.crypto,
    baseUrl =
      import.meta.env?.BASE_URL ?? '/',
    origin =
      globalThis.location?.origin ??
      'http://localhost'
  } = {}) {
    this.fetchFn =
      fetchFn ??
      globalThis.fetch?.bind(globalThis);

    this.cacheStorage = cacheStorage;
    this.crypto = cryptoRef;
    this.baseUrl = baseUrl;
    this.origin = origin;
  }

  async download(
    region,
    {
      onProgress = () => {},
      signal = undefined
    } = {}
  ) {
    this.#assertAvailable();

    const files =
      this.createPlan(region);

    if (!files.length) {
      throw new Error(
        `${region.name} does not define downloadable assets.`
      );
    }

    const token = [
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 8)
    ].join('-');

    const cacheName = [
      CACHE_PREFIX,
      safeSegment(region.id),
      '-v',
      safeSegment(region.version ?? 1),
      '-',
      token
    ].join('');

    const cache =
      await this.cacheStorage.open(cacheName);

    const declaredTotal = files.reduce(
      (total, file) =>
        total + (file.sizeBytes ?? 0),
      0
    );

    let downloadedBytes = 0;
    let completedFiles = 0;
    let verifiedFiles = 0;
    let discoveredTotal = declaredTotal;

    const emit = (file, phase = 'downloading') => {
      onProgress({
        phase,
        region,
        file,
        completedFiles,
        totalFiles: files.length,
        downloadedBytes,
        totalBytes:
          discoveredTotal > 0
            ? discoveredTotal
            : null
      });
    };

    emit(files[0], 'starting');

    try {
      for (const file of files) {
        throwIfAborted(signal);

        const response = await this.fetchFn(
          file.url,
          {
            cache: 'no-store',
            signal
          }
        );

        if (!response.ok) {
          throw new Error(
            `Unable to download ${region.name}: ${file.label} (HTTP ${response.status})`
          );
        }

        const responseSize = Number(
          response.headers?.get?.(
            'content-length'
          )
        );

        if (
          !file.sizeBytes &&
          Number.isFinite(responseSize) &&
          responseSize > 0
        ) {
          discoveredTotal += responseSize;
        }

        let cacheResponse;

        if (file.sha256) {
          const bytes =
            await response.arrayBuffer();

          throwIfAborted(signal);

          const digest =
            await sha256(bytes, this.crypto);

          if (digest !== file.sha256) {
            throw new Error(
              `${region.name} integrity check failed for ${file.label}.`
            );
          }

          verifiedFiles += 1;
          downloadedBytes += bytes.byteLength;
          cacheResponse = cloneResponse(
            response,
            bytes
          );

          emit(file);
        } else {
          cacheResponse =
            progressResponse(
              response,
              chunkBytes => {
                downloadedBytes += chunkBytes;
                emit(file);
              }
            );
        }

        await cache.put(
          file.url,
          cacheResponse
        );

        completedFiles += 1;
        emit(file);
      }

      await this.#removeManagedCaches(
        region.id,
        {
          except: cacheName
        }
      );

      emit(files.at(-1), 'complete');

      return {
        cacheName,
        sizeBytes: downloadedBytes,
        fileCount: files.length,
        verifiedFiles
      };
    } catch (error) {
      await this.cacheStorage.delete(
        cacheName
      );

      if (isAbortError(error, signal)) {
        throw new DOMException(
          'Region download cancelled.',
          'AbortError'
        );
      }

      throw error;
    }
  }

  async remove(region, record = null) {
    this.#assertAvailable();

    if (record?.cacheName) {
      await this.cacheStorage.delete(
        record.cacheName
      );
    }

    await this.#removeManagedCaches(
      region.id
    );

    const legacyCache =
      await this.cacheStorage.open(
        LEGACY_CACHE_NAME
      );

    await Promise.all(
      this.createPlan(region).map(file =>
        legacyCache.delete(file.url)
      )
    );
  }

  createPlan(region) {
    const declaredFiles =
      region.package?.files;

    if (Array.isArray(declaredFiles)) {
      return uniqueFiles(
        declaredFiles
          .map((file, index) =>
            this.#normalizeFile(
              file,
              `file-${index + 1}`
            )
          )
          .filter(Boolean)
      );
    }

    const files = [];

    visitAssets(
      region.assets ?? {},
      [],
      (url, path) => {
        const file = this.#normalizeFile(
          {
            url,
            group: groupForPath(path)
          },
          path.at(-1)
        );

        if (file) {
          files.push(file);
        }
      }
    );

    return uniqueFiles(files);
  }

  #normalizeFile(file, fallbackLabel) {
    const sourceUrl =
      typeof file === 'string'
        ? file
        : file?.url;

    if (!isAssetUrl(sourceUrl)) {
      return null;
    }

    const resolvedUrl =
      this.#resolveUrl(sourceUrl);

    return {
      url: resolvedUrl,
      label:
        file.label ??
        filename(sourceUrl) ??
        fallbackLabel,
      group: file.group ?? 'data',
      sizeBytes:
        positiveNumber(file.sizeBytes),
      sha256:
        normalizeSha256(file.sha256)
    };
  }

  #resolveUrl(url) {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const relativeUrl =
      String(url).replace(/^\//, '');

    return new URL(
      `${this.baseUrl}${relativeUrl}`,
      this.origin
    ).href;
  }

  async #removeManagedCaches(
    regionId,
    { except = null } = {}
  ) {
    const prefix = [
      CACHE_PREFIX,
      safeSegment(regionId),
      '-'
    ].join('');

    const names =
      await this.cacheStorage.keys();

    await Promise.all(
      names
        .filter(name =>
          name.startsWith(prefix) &&
          name !== except
        )
        .map(name =>
          this.cacheStorage.delete(name)
        )
    );
  }

  #assertAvailable() {
    if (
      !this.fetchFn ||
      !this.cacheStorage?.open
    ) {
      throw new Error(
        'Offline downloads require browser Cache Storage support.'
      );
    }
  }
}

function visitAssets(value, path, onFile) {
  if (typeof value === 'string') {
    if (isAssetUrl(value)) {
      onFile(value, path);
    }

    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  Object.entries(value).forEach(
    ([key, child]) => {
      if (
        key === 'bounds' ||
        key === 'id'
      ) {
        return;
      }

      visitAssets(
        child,
        [...path, key],
        onFile
      );
    }
  );
}

function isAssetUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return /^https?:\/\//i.test(value) ||
    value.startsWith('/') ||
    /\.(?:bin|json|geojson|pmtiles)(?:\?.*)?$/i
      .test(value);
}

function groupForPath(path) {
  const root = path[0];

  if (root === 'map') {
    return 'map';
  }

  if (
    root === 'pois' ||
    root === 'index'
  ) {
    return 'places';
  }

  if (root === 'routing') {
    return 'navigation';
  }

  return 'data';
}

function uniqueFiles(files) {
  return [
    ...new Map(
      files.map(file => [file.url, file])
    ).values()
  ];
}

function progressResponse(response, onChunk) {
  if (!response.body?.getReader) {
    return response;
  }

  const reader = response.body.getReader();

  const body = new ReadableStream({
    async pull(controller) {
      const { done, value } =
        await reader.read();

      if (done) {
        controller.close();
        return;
      }

      onChunk(value.byteLength);
      controller.enqueue(value);
    },

    cancel(reason) {
      return reader.cancel(reason);
    }
  });

  return cloneResponse(response, body);
}

function cloneResponse(response, body) {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

async function sha256(bytes, cryptoRef) {
  if (!cryptoRef?.subtle?.digest) {
    throw new Error(
      'This browser cannot verify region package checksums.'
    );
  }

  const digest = await cryptoRef.subtle.digest(
    'SHA-256',
    bytes
  );

  return [...new Uint8Array(digest)]
    .map(value =>
      value.toString(16).padStart(2, '0')
    )
    .join('');
}

function normalizeSha256(value) {
  const normalized = String(value ?? '')
    .replace(/^sha256-/i, '')
    .toLowerCase();

  return /^[a-f0-9]{64}$/.test(normalized)
    ? normalized
    : null;
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0
    ? value
    : null;
}

function filename(url) {
  return String(url)
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .at(-1);
}

function safeSegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ??
      new DOMException(
        'Region download cancelled.',
        'AbortError'
      );
  }
}

function isAbortError(error, signal) {
  return signal?.aborted ||
    error?.name === 'AbortError';
}
