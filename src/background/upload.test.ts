import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendFrameMessage } from './frame-messaging';
import { inspectUploadFilesViaBridge } from './bridge';
import { setNativeUploadFiles } from './native-upload';
import { uploadLocalFiles } from './upload';
import type { PageTarget } from '@/types/workflow';
vi.mock('./frame-messaging', () => ({ sendFrameMessage: vi.fn() }));
vi.mock('./bridge', () => ({ inspectUploadFilesViaBridge: vi.fn() }));
vi.mock('./native-upload', () => ({ setNativeUploadFiles: vi.fn(async (_tab, _token, _paths, validate) => { await validate(); }) }));
const target: PageTarget = { name: '文件', tagName: 'input', label: '', selector: '#files', frameId: 0, frameUrl: 'https://example.com/frame' };
beforeEach(() => { vi.stubGlobal('chrome', { tabs: { sendMessage: vi.fn().mockResolvedValue({}) } }); vi.mocked(setNativeUploadFiles).mockImplementation(async (_tab, _token, _paths, validate) => { await validate(); }); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
it('pins the prepared element token and frame, and returns metadata without file contents', async () => {
  const files = [{ name: 'file.txt', mimeType: 'text/plain', size: 1, path: '/tmp/file.txt', lastModified: 1 }];
  vi.mocked(sendFrameMessage).mockResolvedValueOnce({ ok: true, frameId: 9, frameUrl: target.frameUrl, data: { token: 'token', multiple: true } }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true, data: { files: [{ name: 'file.txt', size: 1 }] } });
  vi.mocked(inspectUploadFilesViaBridge).mockResolvedValue(files);
  const result = await uploadLocalFiles(1, target, '#files', ['/tmp/file.txt']);
  expect(sendFrameMessage).toHaveBeenLastCalledWith(1, 9, { type: 'PAGE_AGENT_VERIFY_UPLOAD', selector: '#files', token: 'token', files: [{ name: 'file.txt', mimeType: 'text/plain', size: 1, lastModified: 1 }] }, target.frameUrl, 0, undefined);
  expect(setNativeUploadFiles).toHaveBeenCalledWith(1, 'token', ['/tmp/file.txt'], expect.any(Function));
  expect(JSON.stringify(result)).not.toContain('/tmp/file.txt');
  expect(result.verification.ok).toBe(true); expect(JSON.stringify(result)).not.toContain('YQ==');
});
it('rejects multiple files for a single input before reading local files', async () => {
  vi.mocked(sendFrameMessage).mockResolvedValue({ ok: true, data: { token: 'token', multiple: false } });
  await expect(uploadLocalFiles(1, target, '#files', ['/tmp/a', '/tmp/b'])).rejects.toThrow('一个文件');
  expect(inspectUploadFilesViaBridge).not.toHaveBeenCalled(); expect(sendFrameMessage).toHaveBeenCalledTimes(1);
});
it('never dispatches file selection after a local file read failure', async () => {
  vi.mocked(sendFrameMessage).mockResolvedValue({ ok: true, data: { token: 'token', multiple: false } });
  vi.mocked(inspectUploadFilesViaBridge).mockRejectedValue(new Error('文件不存在'));
  await expect(uploadLocalFiles(1, target, '#files', '/tmp/missing')).rejects.toThrow('文件不存在');
  expect(sendFrameMessage).toHaveBeenCalledTimes(1);
});
