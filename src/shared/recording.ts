import { createId, createStartNode, EVENT_LABELS, type RecordedPageEvent, type RecordingResult, type WorkflowEdge, type WorkflowNode } from '@/types/workflow';

function cleanName(value: string): string {
  return value.replace(/\s+/g, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20) || '网页节点';
}

function uniqueName(nodes: WorkflowNode[], seed: string): string {
  const base = cleanName(seed);
  let name = base;
  let index = 2;
  while (nodes.some((node) => node.name === name)) name = `${base}_${index++}`;
  return name;
}

export function compactRecordedEvents(events: RecordedPageEvent[]): RecordedPageEvent[] {
  const compacted: RecordedPageEvent[] = [];
  for (const event of events) {
    if (event.event.type === 'doubleClick') {
      while (compacted.length && compacted.length >= 1 && compacted.at(-1)?.event.type === 'click'
        && compacted.at(-1)?.target.selector === event.target.selector && event.timestamp - compacted.at(-1)!.timestamp < 800) {
        compacted.pop();
      }
    }
    const previous = compacted.at(-1);
    const replaceable = event.event.type === 'input' || event.event.type === 'select' || event.event.type === 'check' || event.event.type === 'scrollPage';
    if (previous && replaceable && previous.event.type === event.event.type && previous.target.selector === event.target.selector
      && previous.target.frameId === event.target.frameId && previous.url === event.url) {
      compacted[compacted.length - 1] = event;
    } else {
      compacted.push(event);
    }
  }
  return compacted;
}

export function recordingToGraph(startUrl: string, startedAt: number, stoppedAt: number, rawEvents: RecordedPageEvent[]): RecordingResult {
  const events = compactRecordedEvents(rawEvents);
  const start = createStartNode(createId('start'));
  start.targetUrl = startUrl;
  start.name = '打开录制页面';
  const inputNames = new Set<string>();
  for (const record of events) {
    for (const match of record.event.value?.matchAll(/\{\{([\p{L}\p{N}_-]+)\}\}/gu) ?? []) inputNames.add(match[1]);
  }
  start.inputs = [...inputNames].map((name) => ({ id: createId('parameter'), name, type: 'string', required: true, description: '录制敏感输入时自动创建，值不会写入工作流文件' }));
  const nodes: WorkflowNode[] = [start];
  const edges: WorkflowEdge[] = [];
  let previousId = start.id;

  events.forEach((record, index) => {
    const label = record.target.label || record.target.tagName;
    const name = uniqueName(nodes, `${EVENT_LABELS[record.event.type]}_${label}`);
    const node: WorkflowNode = {
      id: createId('node'),
      kind: 'dom',
      name,
      target: { ...record.target, name },
      event: { ...record.event },
      position: { x: 60 + (index + 1) * 280, y: 80 },
    };
    nodes.push(node);
    edges.push({ id: createId('edge'), sourceNodeId: previousId, targetNodeId: node.id, sourcePort: 'success' });
    previousId = node.id;
  });

  return { startedAt, stoppedAt, startUrl, eventCount: events.length, nodes, edges };
}
