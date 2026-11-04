import type { WorkflowFile } from '@/types/workflow';
export function FileDownloads({data}:{data:unknown}) {
  const recording = data as { type?: string; state?: string; downloadId?: number; fileName?: string } | undefined;
  if (recording?.type === 'mediaRecording') return recording.state === 'saved' && typeof recording.downloadId === 'number'
    ? <button className="secondary" onClick={() => { void chrome.downloads.show(recording.downloadId!); }}>在文件夹中显示 {recording.fileName}</button> : null;
  const raw=data as {type?:string;files?:WorkflowFile[];excel?:{type:string;files:WorkflowFile[]}} | undefined;
  const value=raw?.type==='datatable'?raw.excel:raw;
  if(value?.type!=='files'||!Array.isArray(value.files))return null;
  return <div>{value.files.map((file,index)=><a key={index} className="secondary" download={file.name} href={`data:${file.mimeType};base64,${file.base64}`}>下载 {file.name}</a>)}</div>;
}
