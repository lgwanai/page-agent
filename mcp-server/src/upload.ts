import { open, stat as statFile } from 'node:fs/promises';
import { isAbsolute, basename, extname } from 'node:path';
const MIME: Record<string, string> = { '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.html': 'text/html' };
/** Preflight paths only: bytes stay on disk and Chrome streams them to the website. */
export async function inspectUploadFiles(raw: unknown) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20 || raw.some(path => typeof path !== 'string' || path.length > 4096 || /[\x00\r\n]/.test(path) || !isAbsolute(path))) throw new Error('上传需要 1–20 个本机绝对文件路径；不支持 URL、相对路径或 ~ 展开');
  if (new Set(raw).size !== raw.length) throw new Error('上传文件路径不能重复');
  const files = [];
  let total = 0;
  for (const path of raw as string[]) {
    let handle;
    try {
      if (!(await statFile(path)).isFile()) throw new Error('NOT_REGULAR_FILE');
      handle = await open(path, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new Error('NOT_REGULAR_FILE');
      total += stat.size;
      if (!Number.isSafeInteger(total)) throw new Error('FILE_SIZE_OUT_OF_RANGE');
      files.push({ path, name: basename(path), size: stat.size, mimeType: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', lastModified: Math.floor(stat.mtimeMs) });
    } catch { throw new Error(`上传文件不存在、不是普通文件或无法读取：${basename(path)}`); }
    finally { await handle?.close().catch(() => undefined); }
  }
  return files;
}
