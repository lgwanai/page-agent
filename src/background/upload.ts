import { sendFrameMessage } from './frame-messaging';
import { inspectUploadFilesViaBridge } from './bridge';
import { checkCancellation } from './execution-control';
import { setNativeUploadFiles } from './native-upload';
import { uploadPaths } from '@/shared/upload';
import type { PageTarget } from '@/types/workflow';
export async function uploadLocalFiles(tabId: number, target: PageTarget, selector: string, value: unknown) {
  const paths = uploadPaths(value); checkCancellation();
  const prepared = await sendFrameMessage(tabId, target.frameId ?? 0, { type: 'PAGE_AGENT_PREPARE_UPLOAD', selector, ...(target.locator ? { targetHint: target } : {}) }, target.frameUrl, undefined, target.frameQueryKeys);
  const info = prepared.data as { token: string; multiple: boolean } | undefined;
  if (!prepared.ok || typeof info?.token !== 'string') throw new Error(String(prepared.error ?? '无法定位上传控件'));
  const frameId = Number(prepared.frameId), frameUrl = String(prepared.frameUrl);
  try {
    if (paths.length > 1 && !info.multiple) throw new Error('此上传控件只允许选择一个文件');
    const files = await inspectUploadFilesViaBridge(paths); checkCancellation();
    // Only metadata reaches the content script, never disk paths or file bytes.
    const metadata = files.map(({ name, size, mimeType, lastModified }) => ({ name, size, mimeType, lastModified }));
    await setNativeUploadFiles(tabId, info.token, files.map(file => file.path), async () => {
      const valid = await sendFrameMessage(tabId, frameId, { type: 'PAGE_AGENT_VALIDATE_UPLOAD', selector, token: info.token, files: metadata }, frameUrl, undefined, target.frameQueryKeys);
      if (!valid.ok) throw new Error(String(valid.error ?? '上传控件预检失败'));
    });
    let response;
    try {
      response = await sendFrameMessage(tabId, frameId, { type: 'PAGE_AGENT_VERIFY_UPLOAD', selector, token: info.token, files: metadata }, frameUrl, 0, target.frameQueryKeys);
      if (!response.ok) throw new Error(String(response.error ?? '无法验证文件选择结果'));
    } catch (error) { throw new Error(`文件选择已触发，上传结果可能未知，请检查页面，勿自动重试：${(error as Error).message}`); }
    return { data: response.data, port: 'success' as const, verification: { ok: true, summary: `已选择 ${files.length} 个文件并触发上传控件；服务端上传结果需后续校验`, actual: response.data } };
  } finally {
    await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_RELEASE_UPLOAD', token: info.token }, { frameId }).catch(() => undefined);
  }
}
