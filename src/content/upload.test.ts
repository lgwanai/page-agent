// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { clearUploadTargets, prepareUpload, validateUpload, releaseUpload } from './upload';
afterEach(() => { document.body.innerHTML = ''; clearUploadTargets(); });
it('finds hidden inputs through their label or unique container and reports constraints', () => {
  document.body.innerHTML = '<label for="files" id="label">上传</label><div id="wrapper"><input hidden id="files" type="file" accept=".pdf" multiple></div>';
  expect(prepareUpload('#label')).toMatchObject({ multiple: true, accept: '.pdf' });
  expect(prepareUpload('#wrapper').token).toBeTruthy();
});
it('refuses ambiguous, disabled, non-file and directory controls', () => {
  document.body.innerHTML = '<div id="ambiguous"><input type="file"><input type="file"></div><input id="disabled" type="file" disabled><input id="dir" type="file" webkitdirectory><input id="text">';
  for (const selector of ['#missing', '#ambiguous', '#disabled', '#dir', '#text']) expect(() => prepareUpload(selector)).toThrow();
});
it('rejects a stale token or replaced element before dispatching events', async () => {
  document.body.innerHTML = '<input id="files" type="file">';
  const { token } = prepareUpload('#files'); document.body.innerHTML = '<input id="files" type="file">';
  expect(() => validateUpload(token, [])).toThrow('替换');
  releaseUpload(token);
  expect(() => validateUpload(token, [])).toThrow('过期');
});

it('validates multi-gigabyte metadata without reading or constructing file contents', () => {
  document.body.innerHTML = '<input id="files" type="file" accept=".bin">';
  const { token } = prepareUpload('#files');
  expect(validateUpload(token, [{ name: 'large.bin', size: 5 * 1024 ** 3, mimeType: 'application/octet-stream', lastModified: 1 }])).toEqual({ totalBytes: 5 * 1024 ** 3 });
});
