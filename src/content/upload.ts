import { acceptsFile, UPLOAD_MARKER, UPLOAD_MAX_FILES, type UploadFileInfo } from '@/shared/upload';
const pending = new Map<string, { input: HTMLInputElement; expires: number; timer: ReturnType<typeof setTimeout> }>();
export function releaseUpload(token: string) {
  const item = pending.get(token); if (!item) return;
  clearTimeout(item.timer);
  if (item.input.getAttribute(UPLOAD_MARKER) === token) item.input.removeAttribute(UPLOAD_MARKER);
  pending.delete(token);
}
export function clearUploadTargets() { for (const token of pending.keys()) releaseUpload(token); }
function targetInput(selector: string): HTMLInputElement {
  const targets = [...document.querySelectorAll(selector)];
  if (targets.length !== 1) throw new Error('上传 Selector 必须匹配唯一控件');
  const target = targets[0];
  const candidates = target instanceof HTMLInputElement && target.type === 'file' ? [target]
    : target instanceof HTMLLabelElement && target.control instanceof HTMLInputElement && target.control.type === 'file' ? [target.control]
    : [...target.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  if (candidates.length !== 1) throw new Error('选区中没有唯一的文件上传框，请将 Selector 指向 input[type="file"]、关联的 label 或包含它的容器');
  return candidates[0];
}
function validateInput(input: HTMLInputElement) {
  if (!input.isConnected || input.type !== 'file') throw new Error('上传控件已被页面替换，请重新选择后重试');
  if (input.matches(':disabled')) throw new Error('文件上传控件已禁用');
  if (input.hasAttribute('webkitdirectory') || input.hasAttribute('directory')) throw new Error('当前仅支持文件上传，不支持目录上传');
}
export function prepareUpload(selector: string) {
  const input = targetInput(selector); validateInput(input);
  for (const [token, item] of pending) if (item.input === input || item.expires <= Date.now()) releaseUpload(token);
  if (pending.size >= 20) releaseUpload(pending.keys().next().value!);
  const token = crypto.randomUUID();
  input.setAttribute(UPLOAD_MARKER, token);
  pending.set(token, { input, expires: Date.now() + 60000, timer: setTimeout(() => releaseUpload(token), 60000) });
  return { token, multiple: input.multiple, accept: input.accept };
}
function preparedInput(token: string) {
  const prepared = pending.get(token);
  if (!prepared || prepared.expires <= Date.now()) { releaseUpload(token); throw new Error('上传选区已过期，请重新运行；尚未设置任何文件'); }
  validateInput(prepared.input);
  if (prepared.input.getAttribute(UPLOAD_MARKER) !== token) throw new Error('上传控件已改变，请重新选择后重试');
  return prepared.input;
}
export function validateUpload(token: string, files: UploadFileInfo[]) {
  const input = preparedInput(token);
  if (!Array.isArray(files) || !files.length || files.length > UPLOAD_MAX_FILES) throw new Error('上传文件列表无效');
  if (!input.multiple && files.length > 1) throw new Error('此上传控件只允许选择一个文件');
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name || /[\\/\r\n\x00]/.test(file.name) || typeof file.mimeType !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isFinite(file.lastModified)) throw new Error('上传文件信息格式无效');
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('上传文件大小超出可表示范围');
    if (!acceptsFile(input.accept, file)) throw new Error(`文件类型不符合控件要求：${file.name}；允许 ${input.accept}`);
  }
  return { totalBytes };
}
/** Native Chrome selection already fired input/change. Never replay those events. */
export function verifyUpload(token: string, files: UploadFileInfo[]) {
  try {
    const input = preparedInput(token);
    const actual = Array.from(input.files ?? []).map(file => ({ name: file.name, size: file.size, mimeType: file.type, lastModified: file.lastModified }));
    if (actual.length !== files.length || actual.some((file, index) => file.name !== files[index].name || file.size !== files[index].size || file.lastModified !== files[index].lastModified)) throw new Error('文件选择事件已触发，但控件中的文件被页面改变或清空，上传结果可能未知，请检查页面，勿自动重试');
    return { files: actual, totalBytes: actual.reduce((total, file) => total + file.size, 0), filesSelected: true, serverUploadVerified: false };
  } finally { releaseUpload(token); }
}
