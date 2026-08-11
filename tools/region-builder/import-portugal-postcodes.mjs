#!/usr/bin/env node

import fs from 'node:fs';
import { once } from 'node:events';

const source =
  'data/postcodes/PCODE_PT_2024_4326.geojson';

const output =
  'data/postcodes/portugal-postcodes.geojson';

const FEATURE_MARKER = '{"type": "Feature"';

const input = fs.createReadStream(source, {
  encoding: 'utf8',
  highWaterMark: 8 * 1024 * 1024
});

const out = fs.createWriteStream(output, {
  encoding: 'utf8'
});

const seen = new Set();

let buffer = '';
let first = true;
let written = 0;
let foreign = 0;
let invalid = 0;
let duplicates = 0;

out.write(
  '{"type":"FeatureCollection",' +
  '"metadata":{' +
  '"source":"Eurostat GISCO Postal Codes 2024",' +
  '"country":"Portugal",' +
  '"license":"CC-BY-SA-4.0"' +
  '},' +
  '"features":['
);

function jsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function processFeature(text) {
  if (!/"CNTR_ID"\s*:\s*"PT"/.test(text)) {
    foreign += 1;
    return;
  }

  const postcodeMatch =
    text.match(
      /"POSTCODE"\s*:\s*"([^"]+)"/
    );

  const localityMatch =
    text.match(
      /"LAU_NAME"\s*:\s*"((?:\\.|[^"])*)"/
    );

  const coordinatesMatch =
    text.match(
      /"coordinates"\s*:\s*\[\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\]/
    );

  if (
    !postcodeMatch ||
    !coordinatesMatch
  ) {
    invalid += 1;
    return;
  }

  const postcode =
    postcodeMatch[1].trim().toUpperCase();

  if (seen.has(postcode)) {
    duplicates += 1;
    return;
  }

  const lon = Number(coordinatesMatch[1]);
  const lat = Number(coordinatesMatch[2]);

  if (
    !postcode ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    invalid += 1;
    return;
  }

  const locality =
    localityMatch
      ? jsonString(localityMatch[1])
      : '';

  seen.add(postcode);

  const feature = {
    type: 'Feature',

    id:
      `postcode:${postcode}`,

    geometry: {
      type: 'Point',
      coordinates: [
        lon,
        lat
      ]
    },

    properties: {
      name: postcode,
      type: 'postcode',
      place: 'postcode',
      'addr:postcode': postcode,
      municipality: locality,
      search_only: true,
      source: 'GISCO'
    }
  };

  if (!first) {
    out.write(',');
  }

  out.write(
    JSON.stringify(feature)
  );

  first = false;
  written += 1;

  if (written % 5000 === 0) {
    console.log(
      `  imported ${written.toLocaleString()} Portugal postcodes...`
    );
  }
}

for await (const chunk of input) {
  buffer += chunk;

  while (true) {
    const firstMarker =
      buffer.indexOf(FEATURE_MARKER);

    if (firstMarker === -1) {
      // Keep enough tail to catch a marker split
      // across two read chunks.
      buffer =
        buffer.slice(
          -FEATURE_MARKER.length * 2
        );

      break;
    }

    const nextMarker =
      buffer.indexOf(
        FEATURE_MARKER,
        firstMarker +
          FEATURE_MARKER.length
      );

    if (nextMarker === -1) {
      buffer =
        buffer.slice(firstMarker);

      break;
    }

    processFeature(
      buffer.slice(
        firstMarker,
        nextMarker
      )
    );

    buffer =
      buffer.slice(nextMarker);
  }
}

/*
 * Last feature in the file.
 */
const lastMarker =
  buffer.indexOf(FEATURE_MARKER);

if (lastMarker !== -1) {
  processFeature(
    buffer.slice(lastMarker)
  );
}

out.write(']}');
out.end();

await once(out, 'finish');

const size =
  fs.statSync(output).size;

console.log('');
console.log(
  'Portugal postcode import complete'
);
console.log(
  `Portugal postcodes: ${written.toLocaleString()}`
);
console.log(
  `Foreign skipped:    ${foreign.toLocaleString()}`
);
console.log(
  `Duplicates:         ${duplicates.toLocaleString()}`
);
console.log(
  `Invalid:            ${invalid.toLocaleString()}`
);
console.log(
  `Size:               ${(size / 1024 / 1024).toFixed(1)} MB`
);
