    import fs from 'node:fs/promises';
    import path from 'node:path';

    function readArgs(argv) {
      const values = {};
      for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i]?.replace(/^--/, '');
        values[key] = argv[i + 1];
      }
      return values;
    }

    function flattenCoordinates(coordinates, output = []) {
      if (!Array.isArray(coordinates)) return output;

      if (
        coordinates.length >= 2 &&
        Number.isFinite(coordinates[0]) &&
        Number.isFinite(coordinates[1])
      ) {
        output.push(coordinates);
        return output;
      }

      for (const child of coordinates) {
        flattenCoordinates(child, output);
      }

      return output;
    }

    function representativePoint(geometry) {
      if (!geometry) return null;

      if (geometry.type === 'Point') {
        return geometry.coordinates;
      }

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

      return [
        (minLon + maxLon) / 2,
        (minLat + maxLat) / 2
      ];
    }

    function classify(tags) {
      const amenity = tags.amenity;
      const tourism = tags.tourism;
      const leisure = tags.leisure;

      if ([
        'city',
        'town',
        'village',
        'hamlet',
        'suburb',
        'quarter',
        'neighbourhood',
        'locality',
        'municipality',
        'borough',
        'island'
      ].includes(tags.place)) return 'locality';

      if (amenity === 'cafe' || amenity === 'ice_cream') return 'cafe';

      if (
        ['restaurant', 'fast_food', 'food_court'].includes(amenity)
      ) {
        return 'restaurant';
      }

      if (['pub', 'bar'].includes(amenity)) return 'pub';

      if (['park', 'garden', 'nature_reserve'].includes(leisure)) {
        return 'attraction';
      }

      if (
        tourism ||
        tags.historic ||
        ['theatre', 'cinema', 'arts_centre'].includes(amenity)
      ) {
        return 'attraction';
      }

      return null;
    }

    function compactProperties(properties, type) {
      const output = {
        name: properties.name,
        type,
        amenity:
          properties.amenity ??
          properties.tourism ??
          properties.leisure ??
          properties.historic ??
          'place'
      };

      if (type === 'locality') {
        output.place = properties.place;
        output.search_only = true;
      }

      const optionalKeys = [
        'opening_hours',
        'website',
        'contact:website',
        'phone',
        'contact:phone',
        'wheelchair',
        'addr:housenumber',
        'addr:street',
        'addr:city',
        'addr:postcode',
        'alt_name',
        'short_name',
        'official_name',
        'ref',
        'name:pt',
        'name:en',
        'loc_name',
        'old_name',
        'municipality',
        'district',
        'postal_code',
        'population',
        'wikidata'
      ];

      for (const key of optionalKeys) {
        if (properties[key]) output[key] = properties[key];
      }

      return output;
    }

    const args = readArgs(process.argv.slice(2));
    const required = ['input', 'output', 'metadata', 'id', 'name', 'country', 'bbox'];

    for (const key of required) {
      if (!args[key]) throw new Error(`Missing --${key}`);
    }

    const source = JSON.parse(await fs.readFile(args.input, 'utf8'));
    const seen = new Set();
    const features = [];

    for (const feature of source.features ?? []) {
      const tags = feature.properties ?? {};
      const type = classify(tags);
      const point = representativePoint(feature.geometry);

      if (!type || !tags.name || !point) continue;

      const id = String(feature.id ?? `${tags.name}:${point.join(',')}`);
      if (seen.has(id)) continue;
      seen.add(id);

      features.push({
        type: 'Feature',
        id,
        geometry: {
          type: 'Point',
          coordinates: point
        },
        properties: {
          ...compactProperties(tags, type),
          osm_id: id
        }
      });
    }

    const bbox = args.bbox.split(',').map(Number);
    if (bbox.length !== 4 || bbox.some(value => !Number.isFinite(value))) {
      throw new Error('Invalid --bbox. Expected left,bottom,right,top.');
    }

    await fs.mkdir(path.dirname(args.output), { recursive: true });

    await fs.writeFile(
      args.output,
      JSON.stringify({
        type: 'FeatureCollection',
        metadata: {
          source: 'OpenStreetMap',
          license: 'ODbL-1.0',
          attribution: '© OpenStreetMap contributors'
        },
        features
      }),
      'utf8'
    );

    await fs.writeFile(
      args.metadata,
      JSON.stringify({
        id: args.id,
        name: args.name,
        country: args.country,
        bounds: bbox,
        poiUrl: `/regions/${args.id}/pois.geojson`,
        poiCount: features.length,
        generatedAt: new Date().toISOString(),
        attribution: '© OpenStreetMap contributors',
        dataLicense: 'ODbL-1.0'
      }, null, 2),
      'utf8'
    );

    console.log(`Wrote ${features.length} POIs.`);
