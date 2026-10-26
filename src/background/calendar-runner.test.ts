vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
import type { WorkflowNode } from '@/types/workflow';

const calendar: WorkflowNode = { id: 'calendar', name: '日历', kind: 'calendar', target: { name: '日历', selector: '#calendar', frameId: 0, tagName: 'div', label: '日历' }, date: '2026-10-01', endDate: '2026-10-11', mode: 'range' };
const verification = { ok: false, summary: '日历最终日期校验失败：开始日期被结束日期覆盖', expected: ['2026-10-01', '2026-10-11'], actual: { dates: ['2026-10-11', ''], fields: { start: '2026/10/11', end: '' } }, evidence: ['已确认结束日期输入框获得焦点', '点击日期 2026-10-11'] };
function setup() {
  const send = vi.fn(async (_tab, message) => message.type === 'PAGE_AGENT_PING' ? { ok: true, frameLocator: true }
    : message.type === 'PAGE_AGENT_LOCATE_SELECTOR' ? { ok: true, count: 1 }
      : message.type === 'PAGE_AGENT_SELECT_DATE' ? { ok: false, error: verification.summary, verification } : { ok: true });
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), sendMessage: send }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url: 'https://example.com' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  return send;
}
afterEach(() => { vi.unstubAllGlobals(); });

it('reports the failed calendar and actual field values instead of executing the success successor', async () => {
  const send = setup();
  const next: WorkflowNode = { id: 'submit', name: '业务提交', kind: 'dom', target: { name: '提交', selector: '#submit', tagName: 'button', label: '提交', frameId: 0 }, event: { type: 'click' } };
  const result = await runGraph([calendar, next], [{ id: 'edge', sourceNodeId: 'calendar', targetNodeId: 'submit', sourcePort: 'success' }]);
  expect(result.ok).toBe(false); expect(result.steps).toHaveLength(1);
  expect(result.steps[0]).toMatchObject({ nodeId: 'calendar', ok: false, outputPort: 'failure', verification, diagnostic: { code: 'CALENDAR_VALUE_MISMATCH', phase: 'verification', retryPolicy: 'inspect_before_retry' } });
  expect(send.mock.calls.some(([, message]) => message.type === 'PAGE_AGENT_EXECUTE_EVENT')).toBe(false);
});

it('takes the explicitly configured failure path and retains the mismatch diagnostic', async () => {
  setup();
  const recover: WorkflowNode = { id: 'recover', name: '失败处理', kind: 'wait', durationMs: 0 };
  const result = await runGraph([calendar, recover], [{ id: 'failure', sourceNodeId: 'calendar', targetNodeId: 'recover', sourcePort: 'failure' }]);
  expect(result.steps.map(step => [step.nodeId, step.ok])).toEqual([['calendar', false], ['recover', true]]);
  expect(result.steps[0].verification?.actual).toEqual(verification.actual);
});
