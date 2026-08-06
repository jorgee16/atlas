import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false
    });

    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function filterExpression(categoryRules) {
  const expressions = [];

  for (const rules of Object.values(categoryRules)) {
    for (const rule of rules) {
      if (rule.values.includes('*')) {
        expressions.push(`nwr/${rule.key}`);
      } else {
        expressions.push(`nwr/${rule.key}=${rule.values.join(',')}`);
      }
    }
  }

  return [...new Set(expressions)];
}

export class OsmiumAdapter {
  async verify() {
    try {
      await run('osmium', ['--version']);
    } catch {
      throw new Error(
        'osmium is required by the current region-builder adapter. ' +
        'Install osmium-tool before building a region.'
      );
    }
  }

  async buildIntermediate({ input, bbox, categories, workDir }) {
    await fs.mkdir(workDir, { recursive: true });

    const extractedPbf = path.join(workDir, 'region.osm.pbf');
    const filteredPbf = path.join(workDir, 'pois.osm.pbf');
    const rawGeoJson = path.join(workDir, 'raw-pois.geojson');

    await run('osmium', [
      'extract',
      '--bbox', bbox.join(','),
      '--strategy', 'complete_ways',
      '--overwrite',
      '--output', extractedPbf,
      input
    ]);

    const expressions = filterExpression(categories);

    await run('osmium', [
      'tags-filter',
      '--overwrite',
      '--output', filteredPbf,
      extractedPbf,
      ...expressions
    ]);

    await run('osmium', [
      'export',
      '--add-unique-id', 'type_id',
      '--overwrite',
      '--output', rawGeoJson,
      filteredPbf
    ]);

    return rawGeoJson;
  }
}
