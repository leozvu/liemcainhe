import { copyFile, mkdir, readdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.join(projectRoot, 'dist');
const clientOutput = path.join(buildRoot, 'client');
const workerSource = path.join(projectRoot, 'worker', 'index.js');
const workerOutput = path.join(buildRoot, 'server', 'index.js');

await mkdir(clientOutput, { recursive: true });

for (const entry of await readdir(buildRoot, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') {
    continue;
  }

  await rename(path.join(buildRoot, entry.name), path.join(clientOutput, entry.name));
}

await mkdir(path.dirname(workerOutput), { recursive: true });
await copyFile(workerSource, workerOutput);
