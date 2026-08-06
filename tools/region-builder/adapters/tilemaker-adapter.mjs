import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false
    });

    child.once('error', error => {
      reject(new Error(`Unable to start ${command}: ${error.message}`));
    });

    child.once('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

export class TilemakerAdapter {
  async verify() {
    await run('tilemaker', ['--help']);
  }

  async createPmtiles({
    inputPbf,
    outputPmtiles,
    configPath = null,
    processPath = null,
    temporaryStore = null,
    bbox = null
  }) {
    await fs.mkdir(path.dirname(outputPmtiles), {
      recursive: true
    });

    await fs.rm(outputPmtiles, {
      force: true
    });

    const args = [
      '--input',
      inputPbf,
      '--output',
      outputPmtiles
    ];

    if (bbox) {
      args.push("--bbox", bbox.join(","));
    }

    if (configPath) {
      args.push('--config', configPath);
    }

    if (processPath) {
      args.push('--process', processPath);
    }

    if (temporaryStore) {
      await fs.mkdir(temporaryStore, {
        recursive: true
      });

      args.push('--store', temporaryStore);
    }

    await run('tilemaker', args);

    const stat = await fs.stat(outputPmtiles);

    if (stat.size === 0) {
      throw new Error('Tilemaker produced an empty PMTiles archive.');
    }

    return {
      path: outputPmtiles,
      sizeBytes: stat.size
    };
  }
}
