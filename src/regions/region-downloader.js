import {
  defaultRegionAssetOrigin,
  resolveRegionAssetUrl
} from './region-asset-url.js';

const CACHE_PREFIX =
  'roam-region-v2-';

const LEGACY_CACHE_NAME =
  'roam-regions-v1';

const LARGE_CACHE_BLOB_THRESHOLD_BYTES =
  64 * 1024 * 1024;

export class RegionDownloader {
  constructor({
    fetchFn = null,
    cacheStorage = globalThis.caches,
    cryptoRef = globalThis.crypto,
    baseUrl =
      import.meta.env?.BASE_URL ?? '/',
    origin =
      defaultRegionAssetOrigin()
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

        let response;

        try {
          response = await this.fetchFn(
            file.url,
            {
              cache: 'no-store',
              signal
            }
          );
        } catch (error) {
          throw fileDownloadError(
            region,
            file,
            error
          );
        }

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
        let verification = null;
        let verificationReadyBeforeCache = false;

        const onChunk = chunkBytes => {
          downloadedBytes += chunkBytes;
          emit(file);
        };

        if (shouldUseBlobCacheEntry(file, responseSize)) {
          const prepared =
            await blobBackedCacheResponse(
              response,
              onChunk,
              file.sha256
            );

          cacheResponse = prepared.response;
          verification = prepared.digest;
          verificationReadyBeforeCache = Boolean(
            verification
          );
        } else if (file.sha256) {
          const streamed =
            verifiedProgressResponse(
              response,
              onChunk
            );

          cacheResponse = streamed.response;
          verification = streamed.digest;
          verification.catch(() => {});
        } else {
          cacheResponse =
            progressResponse(
              response,
              onChunk
            );
        }

        try {
          if (verificationReadyBeforeCache) {
            const digest = await verification;

            throwIfAborted(signal);

            if (digest !== file.sha256) {
              throw new Error(
                `${region.name} integrity check failed for ${file.label}.`
              );
            }

            verifiedFiles += 1;
          }

          await cache.put(
            file.url,
            cacheResponse
          );

          if (verification && !verificationReadyBeforeCache) {
            const digest = await verification;

            throwIfAborted(signal);

            if (digest !== file.sha256) {
              throw new Error(
                `${region.name} integrity check failed for ${file.label}.`
              );
            }

            verifiedFiles += 1;
          }
        } catch (error) {
          if (
            isAbortError(error, signal) ||
            String(error?.message ?? '').includes(
              'integrity check failed'
            )
          ) {
            throw error;
          }

          throw fileDownloadError(
            region,
            file,
            error
          );
        }

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
    return resolveRegionAssetUrl(
      url,
      {
        baseUrl: this.baseUrl,
        origin: this.origin
      }
    );
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
    root === 'index' ||
    root === 'search' ||
    root === 'searchRecords'
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

function shouldUseBlobCacheEntry(file, responseSize) {
  const size =
    file.sizeBytes ??
    (Number.isFinite(responseSize)
      ? responseSize
      : 0);

  return size >= LARGE_CACHE_BLOB_THRESHOLD_BYTES;
}

async function blobBackedCacheResponse(
  response,
  onChunk,
  expectedSha256
) {
  const tracked =
    progressResponse(response, onChunk);
  const blob = await tracked.blob();

  return {
    response: cloneResponse(
      response,
      blob
    ),
    digest: expectedSha256
      ? hashBlob(blob)
      : null
  };
}

async function hashBlob(blob) {
  if (!blob?.stream) {
    throw new Error(
      'This browser cannot stream verified region blobs.'
    );
  }

  const hasher = new IncrementalSha256();
  const reader = blob.stream().getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      return hasher.hex();
    }

    hasher.update(value);
  }
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

function verifiedProgressResponse(
  response,
  onChunk
) {
  if (!response.body?.getReader) {
    throw new Error(
      'This browser cannot stream verified region downloads.'
    );
  }

  const reader = response.body.getReader();
  const hasher = new IncrementalSha256();

  let resolveDigest;
  let rejectDigest;
  let settled = false;

  const digest = new Promise(
    (resolve, reject) => {
      resolveDigest = resolve;
      rejectDigest = reject;
    }
  );

  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } =
          await reader.read();

        if (done) {
          controller.close();

          if (!settled) {
            settled = true;
            resolveDigest(hasher.hex());
          }

          return;
        }

        hasher.update(value);
        onChunk(value.byteLength);
        controller.enqueue(value);
      } catch (error) {
        if (!settled) {
          settled = true;
          rejectDigest(error);
        }

        controller.error(error);
      }
    },

    async cancel(reason) {
      if (!settled) {
        settled = true;
        rejectDigest(
          reason instanceof Error
            ? reason
            : new Error(
                'Region download stream cancelled.'
              )
        );
      }

      return reader.cancel(reason);
    }
  });

  return {
    response: cloneResponse(response, body),
    digest
  };
}

class IncrementalSha256 {
  constructor() {
    this.state = new Uint32Array([
      0x6a09e667,
      0xbb67ae85,
      0x3c6ef372,
      0xa54ff53a,
      0x510e527f,
      0x9b05688c,
      0x1f83d9ab,
      0x5be0cd19
    ]);

    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.bytesHashed = 0;
    this.finished = false;
    this.words = new Uint32Array(64);
  }

  update(input) {
    if (this.finished) {
      throw new Error(
        'SHA-256 digest is already finalized.'
      );
    }

    const bytes =
      input instanceof Uint8Array
        ? input
        : new Uint8Array(input);

    this.bytesHashed += bytes.byteLength;

    let offset = 0;

    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      const take = Math.min(
        needed,
        bytes.byteLength
      );

      this.buffer.set(
        bytes.subarray(0, take),
        this.bufferLength
      );
      this.bufferLength += take;
      offset += take;

      if (this.bufferLength === 64) {
        this.#compress(this.buffer);
        this.bufferLength = 0;
      }
    }

    while (offset + 64 <= bytes.byteLength) {
      this.#compress(
        bytes.subarray(offset, offset + 64)
      );
      offset += 64;
    }

    if (offset < bytes.byteLength) {
      const remainder = bytes.subarray(offset);
      this.buffer.set(remainder, 0);
      this.bufferLength = remainder.byteLength;
    }

    return this;
  }

  hex() {
    if (!this.finished) {
      this.#finish();
    }

    return [...this.state]
      .map(value =>
        value.toString(16).padStart(8, '0')
      )
      .join('');
  }

  #finish() {
    const bitLength = this.bytesHashed * 8;
    const high = Math.floor(
      bitLength / 0x100000000
    );
    const low = bitLength >>> 0;

    this.buffer[this.bufferLength] = 0x80;
    this.bufferLength += 1;

    if (this.bufferLength > 56) {
      this.buffer.fill(
        0,
        this.bufferLength,
        64
      );
      this.#compress(this.buffer);
      this.bufferLength = 0;
    }

    this.buffer.fill(
      0,
      this.bufferLength,
      56
    );

    writeUint32Be(this.buffer, 56, high);
    writeUint32Be(this.buffer, 60, low);
    this.#compress(this.buffer);

    this.bufferLength = 0;
    this.finished = true;
  }

  #compress(chunk) {
    const w = this.words;

    for (let i = 0; i < 16; i += 1) {
      const offset = i * 4;
      w[i] = (
        (chunk[offset] << 24) |
        (chunk[offset + 1] << 16) |
        (chunk[offset + 2] << 8) |
        chunk[offset + 3]
      ) >>> 0;
    }

    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (
        rotateRight(x, 7) ^
        rotateRight(x, 18) ^
        (x >>> 3)
      ) >>> 0;
      const s1 = (
        rotateRight(y, 17) ^
        rotateRight(y, 19) ^
        (y >>> 10)
      ) >>> 0;

      w[i] = (
        w[i - 16] +
        s0 +
        w[i - 7] +
        s1
      ) >>> 0;
    }

    let a = this.state[0];
    let b = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    let e = this.state[4];
    let f = this.state[5];
    let g = this.state[6];
    let h = this.state[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = (
        rotateRight(e, 6) ^
        rotateRight(e, 11) ^
        rotateRight(e, 25)
      ) >>> 0;
      const choice = (
        (e & f) ^
        (~e & g)
      ) >>> 0;
      const temp1 = (
        h +
        s1 +
        choice +
        SHA256_K[i] +
        w[i]
      ) >>> 0;
      const s0 = (
        rotateRight(a, 2) ^
        rotateRight(a, 13) ^
        rotateRight(a, 22)
      ) >>> 0;
      const majority = (
        (a & b) ^
        (a & c) ^
        (b & c)
      ) >>> 0;
      const temp2 = (s0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] =
      (this.state[0] + a) >>> 0;
    this.state[1] =
      (this.state[1] + b) >>> 0;
    this.state[2] =
      (this.state[2] + c) >>> 0;
    this.state[3] =
      (this.state[3] + d) >>> 0;
    this.state[4] =
      (this.state[4] + e) >>> 0;
    this.state[5] =
      (this.state[5] + f) >>> 0;
    this.state[6] =
      (this.state[6] + g) >>> 0;
    this.state[7] =
      (this.state[7] + h) >>> 0;
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf,
  0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c,
  0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee,
  0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2
]);

function rotateRight(value, count) {
  return (
    (value >>> count) |
    (value << (32 - count))
  ) >>> 0;
}

function writeUint32Be(bytes, offset, value) {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function fileDownloadError(region, file, error) {
  const detail = String(
    error?.message ?? error ?? 'Network error'
  );

  return new Error(
    `Unable to download ${region.name}: ${file.label} (${formatFileSize(file.sizeBytes)}): ${detail}`,
    { cause: error }
  );
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'unknown size';
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
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
