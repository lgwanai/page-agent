import { afterEach, expect, it, vi } from 'vitest';
import { executeBrowserDialog, hasConfiguredDialog } from './browser-dialog';
import { withAlertConfirmation } from './dialogs';
import { beginExecution, cancelExecution, finishExecution } from './execution-control';
import type { DialogNode } from '@/types/workflow';
const node: DialogNode = { id: 'd', kind: 'dialog', name: '弹窗', target: { name: '按钮', selector: '#button', frameId: 0, tagName: 'button', label: '' }, event: { type: 'click' }, dialogType: 'confirm', action: 'accept', message: '', promptText: '', timeoutMs: 300 };
type Session = { tabId: number; sessionId?: string };
function harness() {
  const listeners = new Set<(source: Session, method: string, params?: object) => void>();
  const detached = new Set<(source: Session) => void>();
  const emit = (source: Session, method: string, params?: object) => [...listeners].forEach(fn => fn(source, method, params));
  const command = vi.fn(async (source: Session, method: string, params?: object) => {
    if (method === 'Page.handleJavaScriptDialog') {
      const value = params as { accept: boolean; promptText?: string };
      emit(source, 'Page.javascriptDialogClosed', { result: value.accept, userInput: value.promptText ?? '' });
    }
  });
  const api = { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined), sendCommand: command, onEvent: { addListener: vi.fn(fn => listeners.add(fn)), removeListener: vi.fn(fn => listeners.delete(fn)) }, onDetach: { addListener: vi.fn(fn => detached.add(fn)), removeListener: vi.fn(fn => detached.delete(fn)) } };
  vi.stubGlobal('chrome', { debugger: api });
  return { emit, command, api, listeners, detached };
}
afterEach(() => { finishExecution(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(['accept', 'dismiss'] as const)('handles confirm %s once and verifies native close before reporting success', async action => {
  const h = harness();
  const trigger = vi.fn(async () => { h.emit({ tabId: 3 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '删除？' }); return 'clicked'; });
  const result = await withAlertConfirmation(3, () => executeBrowserDialog(3, { ...node, action, message: '删除？' }, trigger));
  expect(result).toEqual({ dialog: { type: 'confirm', message: '删除？', accepted: action === 'accept' }, trigger: 'clicked' });
  expect(trigger).toHaveBeenCalledOnce(); expect(h.command.mock.calls.filter(c => c[1] === 'Page.handleJavaScriptDialog')).toEqual([[{ tabId: 3 }, 'Page.handleJavaScriptDialog', { accept: action === 'accept' }]]);
  expect(h.listeners.size).toBe(0); expect(h.detached.size).toBe(0); expect(hasConfiguredDialog(3)).toBe(false);
});
it.each(['accept', 'dismiss'] as const)('handles prompt %s with empty/Unicode input and no promptText when cancelling', async action => {
  const h = harness();
  const result = await withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, dialogType: 'prompt', action, promptText: '中文\n测试' }, async () => { h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'prompt', message: '备注', defaultPrompt: '默认' }); }));
  expect(result.dialog).toMatchObject({ accepted: action === 'accept', defaultPrompt: '默认', promptText: action === 'accept' ? '中文\n测试' : undefined });
  expect(h.command).toHaveBeenCalledWith({ tabId: 1 }, 'Page.handleJavaScriptDialog', { accept: action === 'accept', ...(action === 'accept' ? { promptText: '中文\n测试' } : {}) });
});
it.each(['alert', 'beforeunload'] as const)('handles explicit %s and does not compete with the alert default', async dialogType => {
  const h = harness();
  await withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, dialogType }, async () => h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: dialogType, message: '' })));
  expect(h.command.mock.calls.filter(c => c[1] === 'Page.handleJavaScriptDialog')).toHaveLength(1);
});
it('uses child debugger sessions for cross-origin iframe dialogs and ignores other tabs', async () => {
  const h = harness();
  await withAlertConfirmation(1, () => executeBrowserDialog(1, node, async () => {
    h.emit({ tabId: 1 }, 'Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } });
    h.emit({ tabId: 9 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'other' });
    h.emit({ tabId: 1, sessionId: 'child' }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'child' });
  }));
  expect(h.command).toHaveBeenCalledWith({ tabId: 1, sessionId: 'child' }, 'Page.handleJavaScriptDialog', { accept: true });
  expect(h.command.mock.calls.some(c => c[0].tabId === 9)).toBe(false);
});
it.each([{ dialogType: 'confirm', actual: 'alert', message: '' }, { dialogType: 'confirm', actual: 'confirm', message: 'expected' }] as const)('rejects mismatched $actual without answering or retrying', async config => {
  const h = harness(); const trigger = vi.fn(async () => { h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: config.actual, message: 'wrong' }); return new Promise<never>(() => undefined); });
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, dialogType: config.dialogType, message: config.message }, trigger))).rejects.toThrow('不匹配');
  expect(trigger).toHaveBeenCalledOnce(); expect(h.command.mock.calls.filter(c => c[1] === 'Page.handleJavaScriptDialog')).toHaveLength(0); expect(h.listeners.size).toBe(0);
});
it('does not confuse command dispatch with confirmed closure and times out without replay', async () => {
  const h = harness(); h.command.mockImplementation(async () => undefined);
  const trigger = vi.fn(async () => h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' }));
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, timeoutMs: 100 }, trigger))).rejects.toThrow('等待超过');
  expect(trigger).toHaveBeenCalledOnce(); expect(h.listeners.size).toBe(0);
});
it('fails on handling refusal and detaches its debugger', async () => {
  const h = harness(); h.command.mockImplementation(async (_s, method) => { if (method === 'Page.handleJavaScriptDialog') throw new Error('refused'); });
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, node, async () => h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' })))).rejects.toThrow('refused');
  expect(h.api.detach).toHaveBeenCalledOnce(); expect(h.listeners.size).toBe(0);
});
it('rejects an actual response different from the configured choice', async () => {
  const h = harness(); h.command.mockImplementation(async (source, method) => { if (method === 'Page.handleJavaScriptDialog') h.emit(source, 'Page.javascriptDialogClosed', { result: false }); });
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, node, async () => h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' })))).rejects.toThrow('不一致');
});
it('cancels a pending dialog wait immediately and cleans up before the next run', async () => {
  const h = harness(); const id = beginExecution();
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, timeoutMs: 60000 }, async () => { cancelExecution(id); }))).rejects.toThrow('运行已停止');
  expect(h.listeners.size).toBe(0); expect(h.detached.size).toBe(0); expect(hasConfiguredDialog(1)).toBe(false);
});
it('does not dispatch a late trigger if setup finishes after timeout', async () => {
  const h = harness(); let release = () => {}; const blocked = new Promise<void>(resolve => { release = resolve; });
  h.command.mockImplementation(async (_s, method, params) => { if (method === 'Target.setAutoAttach' && (params as { autoAttach?: boolean })?.autoAttach) await blocked; }); const trigger = vi.fn();
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, timeoutMs: 100 }, trigger))).rejects.toThrow('等待超过');
  release(); await Promise.resolve(); await Promise.resolve(); expect(trigger).not.toHaveBeenCalled();
});
it('allows a following alert after confirm while rejecting a second confirm', async () => {
  const h = harness();
  await withAlertConfirmation(1, () => executeBrowserDialog(1, node, async () => {
    h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' });
    await Promise.resolve(); h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'alert', message: '完成' });
  }));
  expect(h.command.mock.calls.filter(c => c[1] === 'Page.handleJavaScriptDialog')).toHaveLength(2);
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, node, async () => {
    h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' });
    h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'second' });
    return new Promise<never>(() => undefined);
  }))).rejects.toThrow('多个');
});

it('rejects a dialog from a different document without answering it', async () => {
  const h = harness();
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, target: { ...node.target, frameUrl: 'https://example.com/form', frameQueryKeys: ['activityId'] } }, async () => {
    h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '', url: 'https://example.com/other' });
  }))).rejects.toThrow('来源不匹配');
  expect(h.command.mock.calls.filter(c => c[1] === 'Page.handleJavaScriptDialog')).toHaveLength(0);
});
it('accepts stable document identity when only an excluded runtime query parameter changes', async () => {
  const h = harness();
  const result = await withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, target: { ...node.target, frameUrl: 'https://example.com/form?activityId=1&processId=old', frameQueryKeys: ['activityId'] } }, async () => {
    h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '', url: 'https://example.com/form?activityId=1&processId=new' });
  }));
  expect(result.dialog.accepted).toBe(true);
});
it('fails promptly if Chrome detaches the debugger during the wait', async () => {
  const h = harness();
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, { ...node, timeoutMs: 60000 }, async () => {
    h.detached.forEach(fn => fn({ tabId: 1 }));
    return new Promise<never>(() => undefined);
  }))).rejects.toThrow('调试连接已断开');
  expect(h.listeners.size).toBe(0); expect(h.detached.size).toBe(0);
});
it('preserves a trigger error even if an expected dialog has already closed', async () => {
  const h = harness();
  await expect(withAlertConfirmation(1, () => executeBrowserDialog(1, node, async () => {
    h.emit({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: '' });
    throw new Error('trigger failed');
  }))).rejects.toThrow('trigger failed');
});
