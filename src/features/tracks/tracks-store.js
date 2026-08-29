const DATABASE_NAME = 'atlas-tracks';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tracks';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, operation) {
  const database = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = operation(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

export async function listTracks() {
  const tracks = await transaction('readonly', store => store.getAll());
  return tracks.sort((a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0));
}

export function saveTrack(track) {
  return transaction('readwrite', store => store.put(track));
}

export function deleteTrack(id) {
  return transaction('readwrite', store => store.delete(id));
}

function directText(element, selector) {
  const value = element.querySelector(selector)?.textContent?.trim();
  return value || null;
}

function parsePoint(element) {
  const lat = Number(element.getAttribute('lat'));
  const lon = Number(element.getAttribute('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const elevation = Number(directText(element, 'ele'));
  const timestamp = Date.parse(directText(element, 'time') ?? '');

  return {
    lat,
    lon,
    ...(Number.isFinite(elevation) ? { elevation } : {}),
    ...(Number.isFinite(timestamp) ? { timestamp } : {})
  };
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function trackStats(points) {
  let distance = 0;
  let ascent = 0;
  let descent = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    distance += distanceMeters(previous, current);

    if (
      Number.isFinite(previous.elevation) &&
      Number.isFinite(current.elevation)
    ) {
      const delta = current.elevation - previous.elevation;
      if (delta > 0) ascent += delta;
      else descent += Math.abs(delta);
    }
  }

  const timed = points.filter(point => Number.isFinite(point.timestamp));
  const duration = timed.length >= 2
    ? Math.max(0, timed[timed.length - 1].timestamp - timed[0].timestamp)
    : null;

  return {
    distanceMeters: Math.round(distance),
    ascentMeters: Math.round(ascent),
    descentMeters: Math.round(descent),
    durationMs: duration,
    pointCount: points.length
  };
}

function trackName(document, fileName) {
  const gpxName =
    directText(document, 'gpx > metadata > name') ||
    directText(document, 'trk > name') ||
    directText(document, 'rte > name');

  return gpxName || fileName.replace(/\.gpx$/i, '') || 'Imported track';
}

export async function parseGpxFile(file) {
  const xml = await file.text();
  const document = new DOMParser().parseFromString(xml, 'application/xml');

  if (document.querySelector('parsererror')) {
    throw new Error('The GPX file is not valid XML.');
  }

  const trackElements = Array.from(document.querySelectorAll('trkpt'));
  const routeElements = Array.from(document.querySelectorAll('rtept'));
  const source = trackElements.length >= 2 ? trackElements : routeElements;
  const points = source.map(parsePoint).filter(Boolean);

  if (points.length < 2) {
    throw new Error('The GPX file does not contain a usable track.');
  }

  const id = globalThis.crypto?.randomUUID?.() ??
    `track-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id,
    name: trackName(document, file.name),
    fileName: file.name,
    fileSize: file.size,
    importedAt: Date.now(),
    points,
    stats: trackStats(points)
  };
}
