import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectUploadFiles } from '../src/upload';
let folder: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'page-agent-upload-')); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });
it('reads local binary and Unicode filenames without changing bytes, including zero-byte files', async () => {
  const binary = Buffer.from([0, 1, 2, 127, 255]);
  const first = join(folder, '中文 report.pdf'); const second = join(folder, 'empty.txt');
  await writeFile(first, binary); await writeFile(second, '');
  const result = await inspectUploadFiles([first, second]);
  expect(result[0]).toMatchObject({ name: '中文 report.pdf', size: 5, mimeType: 'application/pdf' });
  expect(result[0].path).toBe(first);
  expect(result[0]).not.toHaveProperty('base64');
  expect(result[1]).toMatchObject({ name: 'empty.txt', size: 0 });
});
it('rejects missing files, folders, URL and relative paths before returning content', async () => {
  for (const value of [[join(folder, 'missing.pdf')], [folder], ['relative.pdf'], ['https://example.com/a'], ['~/file'], []]) await expect(inspectUploadFiles(value)).rejects.toThrow();
});
it('preflights a 5 GiB sparse file with a metadata-only response instead of allocating its bytes', async () => {
  const path = join(folder, 'large.bin'); await writeFile(path, ''); await truncate(path, 5 * 1024 ** 3);
  const files = await inspectUploadFiles([path]);
  expect(files[0].size).toBe(5 * 1024 ** 3);
  expect(JSON.stringify(files).length).toBeLessThan(1000);
  expect(files[0]).not.toHaveProperty('base64');
});
