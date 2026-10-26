// Documentation-only update: preserve every executable payload and its Unix permissions.
import { createWriteStream, constants } from 'node:fs';
import { copyFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import { customerGuideFiles, writeCustomerGuide } from './customer-guide.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deliveries = join(root, 'deliverables');
const targets = [
  'Page-Agent-0.10.35-Windows-x64.zip',
  'Page-Agent-0.10.36-macOS-arm64.zip',
  'Page-Agent-0.10.36-macOS-x64.zip',
];
await writeCustomerGuide(deliveries);
const guides = await customerGuideFiles();
const backups = join(deliveries, '.documentation-backups');
await mkdir(backups, { recursive: true });
for (const name of targets) {
  const source = join(deliveries, name);
  const original = await unzipper.Open.file(source);
  const prefix = name.includes('-macOS-') ? name.slice(0, -4) + '/' : '';
  const guideNames = new Set(Object.keys(guides).map(file => prefix + file));
  const backup = join(backups, basename(name));
  // Keep an untouched recoverable copy; do not silently replace an older backup.
  await copyFile(source, backup, constants.COPYFILE_EXCL);
  const temporary = source + '.with-guide';
  const output = createWriteStream(temporary, { flags: 'wx' });
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); zip.on('error', reject); });
  zip.pipe(output);
  for (const entry of original.files) {
    if (guideNames.has(entry.path)) continue;
    const unixMode = entry.externalFileAttributes >>> 16;
    const mode = unixMode & 0o777;
    if ((unixMode & 0o170000) === 0o120000) {
      zip.symlink(entry.path, (await entry.buffer()).toString('utf8'), mode);
    } else {
      zip.append(entry.type === 'Directory' ? '' : entry.stream(), {
        name: entry.path, mode: mode || (entry.type === 'Directory' ? 0o755 : 0o644),
        type: entry.type === 'Directory' ? 'directory' : 'file', date: entry.lastModifiedDateTime,
      });
    }
  }
  for (const [file, data] of Object.entries(guides)) zip.append(data, { name: prefix + file, mode: 0o644 });
  await zip.finalize();
  await done;
  const updated = await unzipper.Open.file(temporary);
  const entries = new Map(updated.files.map(entry => [entry.path, entry]));
  for (const old of original.files) {
    if (guideNames.has(old.path)) continue;
    const entry = entries.get(old.path);
    if (!entry || entry.crc32 !== old.crc32 || entry.uncompressedSize !== old.uncompressedSize || (entry.externalFileAttributes >>> 16 & 0o777) !== (old.externalFileAttributes >>> 16 & 0o777)) throw new Error(`Payload/permission mismatch: ${name}: ${old.path}`);
  }
  for (const [file, data] of Object.entries(guides)) {
    if ((await entries.get(prefix + file)?.buffer())?.toString('utf8') !== data) throw new Error(`Missing guide: ${file}`);
  }
  await rename(temporary, source);
  console.log(`Updated ${name}: guide added; existing payloads and permissions unchanged.`);
}
console.log(`Original archives retained in ${backups}`);
