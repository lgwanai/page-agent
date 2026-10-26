import { expect, it } from 'vitest';
import { acceptsFile, uploadPaths } from './upload';
it('preserves spaces, commas and Windows backslashes and accepts typed array variables', () => {
  expect(uploadPaths(' C:\\Users\\Li\\report, final.xlsx\n/Users/li/报告.pdf ')).toEqual(['C:\\Users\\Li\\report, final.xlsx', '/Users/li/报告.pdf']);
  expect(uploadPaths(['/tmp/one', '/tmp/two'])).toEqual(['/tmp/one', '/tmp/two']);
  expect(uploadPaths('["/tmp/a", "/tmp/b"]')).toEqual(['/tmp/a', '/tmp/b']);
});
it('rejects missing, duplicate, oversized lists and malformed structured values', () => {
  for (const value of [undefined, '', {}, [], ['a', 'a'], ['a', 1], ['a\0'], Array.from({ length: 21 }, (_, index) => String(index)), '[bad json]']) expect(() => uploadPaths(value)).toThrow();
});
it('matches accept extensions, exact MIME and wildcard MIME case insensitively', () => {
  expect(acceptsFile('.PDF,image/*', { name: '报告.PDF', mimeType: 'application/pdf' })).toBe(true);
  expect(acceptsFile('image/*', { name: 'a.png', mimeType: 'image/png' })).toBe(true);
  expect(acceptsFile('application/pdf', { name: 'report.pdf', mimeType: 'application/pdf' })).toBe(true);
  expect(acceptsFile('image/*', { name: 'report.pdf', mimeType: 'application/pdf' })).toBe(false);
});
