// Classic single-file content script: no dynamic import / WAR manifest cache dependency.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const manifestPath = resolve(root, 'dist/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.version !== source.version) throw new Error('Content build version mismatch');
const result = await build({
  absWorkingDir: root, entryPoints: ['src/content/index.ts'], outfile: 'dist/content-script.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome110',
  minify: true, sourcemap: true, metafile: true,
});
if (Object.values(result.metafile.outputs).some(output => output.imports.length)) throw new Error('Content script must be self-contained');
manifest.content_scripts = source.content_scripts.map(entry => ({ ...entry, js: ['content-script.js'] }));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built self-contained content-script.js for v${manifest.version}`);
