import { readFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
const root = fileURLToPath(new URL('../', import.meta.url));
const project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const file of ['manifest.json', 'dist/manifest.json', 'package-lock.json']) {
  const value = JSON.parse(await readFile(resolve(root, file), 'utf8'));
  if (value.version !== project.version || (value.packages && value.packages[''].version !== project.version)) throw new Error(`Release version mismatch: ${file}`);
}
await mkdir(resolve(root, 'deliverables'), { recursive: true });
const output = resolve(root, 'deliverables', `page-agent-extension-${project.version}.zip`);
const stream = createWriteStream(output);
const archive = new ZipArchive({ zlib: { level: 9 } });
const done = new Promise((resolve, reject) => { stream.on('close', resolve); stream.on('error', reject); archive.on('error', reject); });
archive.pipe(stream); archive.directory(resolve(root, 'dist'), false);
await archive.finalize(); await done;
console.log(output);
