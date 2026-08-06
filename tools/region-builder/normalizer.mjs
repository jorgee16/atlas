import fs from 'node:fs/promises';
import path from 'node:path';

function flattenCoordinates(value, output = []) {
  if (!Array.isArray(value)) return output;

  if (
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    output.push(value);
    return output;
  }

  for (const child of value) {
    flattenCoordinates(child, output);
  }

  return output;
}

function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;

  const points = flattenCoordinates(geometry.coordinates);
  if (!points.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function matchesRule(tags, rule) {
  const value = tags[rule.key];
  if (!value) return false;
  return rule.values.includes('*') || rule.values.includes(value);
}

function categoryFor(tags, categories) {
  for (const [category, rules] of Object.entries(categories)) {
    if (rules.some(rule => matchesRule(tags, rule))) {
      return category;
    }
  }
  return null;
}

function compactProperties(tags, category) {
  const output = {
    name: tags.name,
    type: category,
    amenity:
      tags.amenity ??
      tags.tourism ??
      tags.leisure ??
      tags.historic ??
      'place'
  };

  for (const key of [
    'opening_hours',
    'website',
    'contact:website',
    'phone',
    'contact:phone',
    'wheelchair',
    'addr:housenumber',
    'addr:street',
    'addr:city'
  ]) {
    if (tags[key]) output[key] = tags[key];
  }

  return output;
}

export async function normalizeRegion({
  rawGeoJson,
  config,
  outputDir
}) {
  const source = JSON.parse(await fs.readFile(rawGeoJson, 'utf8'));
  const seen = new Set();
  const features = [];

  for (const feature of source.features ?? []) {
    const tags = feature.properties ?? {};
    const category = categoryFor(tags, config.categories);
    const coordinates = representativePoint(feature.geometry);

    if (!tags.name || !category || !coordinates) continue;

    const id = String(
      feature.id ?? `${tags.name}:${coordinates[0]}:${coordinates[1]}`
    );

    if (seen.has(id)) continue;
    seen.add(id);

    features.push({
      type: 'Feature',
      id,
      geometry: {
        type: 'Point',
        coordinates
      },
      properties: {
        ...compactProperties(tags, category),
        osm_id: id
      }
    });
  }

  await fs.mkdir(outputDir, { recursive: true });

  const poiDocument = {
    type: 'FeatureCollection',
    metadata: {
      source: 'OpenStreetMap',
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors'
    },
    features
  };

  const metadata = {
    id: config.id,
    name: config.name,
    country: config.country,
    bounds: config.bbox,
    poiUrl: `/regions/${config.id}/pois.geojson`,
    poiCount: features.length,
    generatedAt: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors',
    dataLicense: 'ODbL-1.0'
  };

  await fs.writeFile(
    path.join(outputDir, 'pois.geojson'),
    JSON.stringify(poiDocument),
    'utf8'
  );

  await fs.writeFile(
    path.join(outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  return metadata;
}
