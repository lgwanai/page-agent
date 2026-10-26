export const UPLOAD_MAX_FILES = 20;
export const UPLOAD_MARKER = 'data-page-agent-upload-token';
export interface UploadFileInfo { name: string; size: number; mimeType: string; lastModified: number }
export interface UploadFilePath extends UploadFileInfo { path: string }
export function uploadPaths(value: unknown): string[] {
  let paths: unknown = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('[')) { try { paths = JSON.parse(text); } catch { throw new Error('上传文件路径列表不是有效的 JSON 数组'); } }
    else paths = text.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
  }
  if (!Array.isArray(paths) || !paths.length || paths.length > UPLOAD_MAX_FILES || paths.some(path => typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00\r\n]/.test(path))) throw new Error('请提供 1–20 个有效文件路径（文本、每行一个路径或字符串数组）');
  const result = (paths as string[]).map(path => path.trim());
  if (new Set(result).size !== result.length) throw new Error('上传文件路径不能重复');
  return result;
}
export function acceptsFile(accept: string, file: Pick<UploadFileInfo, 'name' | 'mimeType'>): boolean {
  const patterns = accept.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  const name = file.name.toLowerCase(), mime = file.mimeType.toLowerCase();
  return !patterns.length || patterns.some(pattern => pattern.startsWith('.') ? name.endsWith(pattern) : pattern.endsWith('/*') ? mime.startsWith(pattern.slice(0, -1)) : mime === pattern);
}
