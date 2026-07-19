import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerSource = path.join(projectRoot, 'worker', 'index.js');
const workerOutput = path.join(projectRoot, 'dist', 'server', 'index.js');

await mkdir(path.dirname(workerOutput), { recursive: true });
await copyFile(workerSource, workerOutput);
