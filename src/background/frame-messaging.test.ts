import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFrameMessage } from './frame-messaging';

const action = { type: 'PAGE_AGENT_EXECUTE_EVENT', selector: '#datePeriod', event: { type: 'click' } };
const frame = (frameId: number, url = 'https://example.com/form') => ({ frameId, url });

function setup(frames = [frame(0), frame(47)]) {
  const execute = vi.fn().mockResolvedValue({ ok: true, data: 'clicked' });
  const send = vi.fn(async (_tabId: number, message: { type: string }, { frameId }: { frameId: number }) => {
    if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: frameId === 47 ? 1 : 0 };
    return execute(frameId, message);
  });
  const inject = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('chrome', {
    tabs: { sendMessage: send }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue(frames) },
    runtime: { getManifest: () => ({ content_scripts: [{ js: ['content-loader.js'] }] }) },
    scripting: { executeScript: inject },
  });
  return { send, execute, inject, frames: chrome.webNavigation.getAllFrames };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('workflow frame delivery', () => {
  it('finds a selector inside a nested cross-origin iframe and executes there, not in its parents', async () => {
    const { execute } = setup([frame(0, 'https://parent.example/app'), frame(7, 'https://middle.example/frame'), frame(47, 'https://child.example/form')]);
    const result = await sendFrameMessage(1, 0, action);
    expect(result.frameId).toBe(47);
    expect(result.frameUrl).toBe('https://child.example/form');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(47, action);
  });

  it('does not choose a parent-page lookalike when a default-frame node matches multiple documents', async () => {
    const { send, execute } = setup();
    send.mockImplementation(async (_tabId, message) => message.type === 'PAGE_AGENT_LOCATE_SELECTOR' ? { ok: true, count: 1 } : { ok: true, frameLocator: true });
    await expect(sendFrameMessage(1, 0, action)).rejects.toThrow('多个 frame');
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves a saved main-document URL scope instead of selecting a child', async () => {
    const { execute } = setup([frame(0, 'https://parent.example/app'), frame(47, 'https://child.example/form')]);
    await expect(sendFrameMessage(1, 0, action, 'https://parent.example/app', 0)).rejects.toThrow('无法在当前页面定位节点');
    expect(execute).not.toHaveBeenCalled();
  });

  it('pins dispatch to the document that was located, not a replacement document in the same frame', async () => {
    const frames = [{ ...frame(47), documentId: 'current-document' }];
    const { send } = setup(frames);
    await sendFrameMessage(1, 33, action);
    expect(send).toHaveBeenCalledWith(1, action, { frameId: 47, documentId: 'current-document' });
  });

  it('reports the actual iframe URL and ID when a located control is disabled', async () => {
    const { execute } = setup([frame(47, 'https://child.example/form')]);
    execute.mockResolvedValue({ ok: false, error: '目标节点当前处于禁用状态' });
    const result = await sendFrameMessage(1, 33, action);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('目标节点当前处于禁用状态（实际命中 frame 47：https://child.example/form）');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('waits for an iframe created after the main page has already completed loading', async () => {
    vi.useFakeTimers();
    const { execute, frames } = setup();
    vi.mocked(frames).mockResolvedValueOnce([frame(0)] as chrome.webNavigation.GetAllFrameResultDetails[]);
    const pending = sendFrameMessage(1, 33, action);
    await vi.runAllTimersAsync();
    expect((await pending).frameId).toBe(47);
    expect(frames).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('waits for an asynchronously rendered form without replaying any operation', async () => {
    vi.useFakeTimers();
    const { send, execute } = setup([frame(47)]);
    let probes = 0;
    send.mockImplementation(async (_tabId, message, { frameId }) => {
      if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
      if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: ++probes >= 3 ? 1 : 0 };
      return execute(frameId, message);
    });
    const pending = sendFrameMessage(1, 33, action);
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(probes).toBe(3);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('reports a bounded timeout with frame/script diagnostics, without executing the event', async () => {
    vi.useFakeTimers();
    const { execute } = setup([frame(0)]);
    const pending = sendFrameMessage(1, 33, action, undefined, 500);
    const assertion = expect(pending).rejects.toThrow('等待节点 0.5 秒');
    await vi.runAllTimersAsync();
    await assertion;
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the same recorded identity to the read-only probe and actual execution', async () => {
    const { send, execute } = setup([frame(47)]);
    const targetHint = { tagName: 'input', attributes: { placeholder: '结束日期' } };
    const message = { ...action, targetHint };
    await sendFrameMessage(1, 33, message);
    expect(send).toHaveBeenCalledWith(1, { type: 'PAGE_AGENT_LOCATE_SELECTOR', selector: action.selector, targetHint }, { frameId: 47 });
    expect(execute).toHaveBeenCalledWith(47, message);
  });
  it('rebinds a legacy workflow to the unique current iframe, without sending to a stale ID', async () => {
    const { send, execute } = setup();
    expect(await sendFrameMessage(1, 33, action)).toEqual({ ok: true, data: 'clicked', frameId: 47, frameUrl: 'https://example.com/form' });
    expect(send.mock.calls.every((call) => call[2].frameId !== 33)).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(47, action);
  });

  it('waits for the async content loader before dispatching an operation', async () => {
    vi.useFakeTimers();
    const { send, inject, execute } = setup([frame(47)]);
    send.mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ok: true, frameLocator: true });
    const result = sendFrameMessage(1, 47, action);
    await vi.runAllTimersAsync();
    expect((await result).ok).toBe(true);
    expect(inject).toHaveBeenCalledWith({ target: { tabId: 1, frameIds: [47] }, files: ['content-loader.js'] });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('uses the saved frame URL when a previous frame ID now points to another document', async () => {
    const { execute } = setup([frame(33, 'https://example.com/other'), frame(47)]);
    await sendFrameMessage(1, 33, action, 'https://example.com/form#section');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(47, action);
  });

  it('fails safely on ambiguous frame matches, without clicking anything', async () => {
    const { send, execute } = setup([frame(47), frame(48)]);
    send.mockImplementation(async (_tabId, message) => message.type === 'PAGE_AGENT_LOCATE_SELECTOR' ? { ok: true, count: 1 } : { ok: true, frameLocator: true });
    await expect(sendFrameMessage(1, 33, action)).rejects.toThrow('多个 frame');
    expect(execute).not.toHaveBeenCalled();
    expect(send.mock.calls.some((call) => call[1].type === action.type)).toBe(false);
  });

  it('does not replay a click when its response channel closes after dispatch', async () => {
    const { execute, inject } = setup([frame(47)]);
    execute.mockRejectedValue(new Error('The message port closed before a response was received'));
    await expect(sendFrameMessage(1, 47, action)).rejects.toThrow('message port closed');
    expect(execute).toHaveBeenCalledOnce();
    expect(inject).not.toHaveBeenCalled();
  });

  it('recovers an iframe selector from an old node with a default frameId of zero', async () => {
    const { execute } = setup();
    expect((await sendFrameMessage(1, 0, action)).frameId).toBe(47);
    expect(execute).toHaveBeenCalledWith(47, action);
  });

  it('reports a missing saved frame document without using another frame', async () => {
    const { execute } = setup();
    await expect(sendFrameMessage(1, 33, action, 'https://example.com/missing', 0)).rejects.toThrow('目标 frame 文档');
    expect(execute).not.toHaveBeenCalled();
  });

  it('upgrades an old content listener that responds to ping but has no frame locator', async () => {
    const { send, inject, execute } = setup([frame(47)]);
    send.mockResolvedValueOnce({ ok: true });
    expect((await sendFrameMessage(1, 47, action)).ok).toBe(true);
    expect(inject).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('can resolve another frame when an unrelated frame navigates during the read-only probe', async () => {
    const { send, execute } = setup();
    send.mockImplementation(async (_tabId, message, { frameId }) => {
      if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
      if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') {
        if (frameId === 0) throw new Error('Receiving end does not exist');
        return { ok: true, count: 1 };
      }
      return execute(frameId, message);
    });
    expect((await sendFrameMessage(1, 33, action)).frameId).toBe(47);
    expect(execute).toHaveBeenCalledOnce();
  });
});
