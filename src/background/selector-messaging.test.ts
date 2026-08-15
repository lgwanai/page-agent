import { describe, expect, it, vi } from 'vitest';
import { sendSelectorToFrames } from './selector-messaging';

describe('sendSelectorToFrames', () => {
  it('delivers directly when the content script is already present', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const inject = vi.fn();

    await expect(sendSelectorToFrames(
      [{ frameId: 0 }],
      { type: 'PAGE_AGENT_START_SELECT' },
      { send, inject, contentScriptFiles: ['assets/content.js'] },
    )).resolves.toBe(1);

    expect(send).toHaveBeenCalledOnce();
    expect(inject).not.toHaveBeenCalled();
  });

  it('injects the manifest content script and retries an already-open frame', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce({ ok: true });
    const inject = vi.fn().mockResolvedValue([]);

    await expect(sendSelectorToFrames(
      [{ frameId: 7 }],
      { type: 'PAGE_AGENT_START_SELECT' },
      { send, inject, contentScriptFiles: ['assets/content.js'] },
    )).resolves.toBe(1);

    expect(inject).toHaveBeenCalledWith(7, ['assets/content.js']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not report a false success when no frame can receive selection', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
    const inject = vi.fn().mockRejectedValue(new Error('Cannot access chrome:// URL'));

    await expect(sendSelectorToFrames(
      [{ frameId: 0 }],
      { type: 'PAGE_AGENT_START_SELECT' },
      { send, inject, contentScriptFiles: ['assets/content.js'] },
    )).rejects.toThrow('无法在当前页面启动 Selector');
  });

  it('stops only frames that already have a receiver and never injects', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
    const inject = vi.fn();

    await expect(sendSelectorToFrames(
      [{ frameId: 0 }],
      { type: 'PAGE_AGENT_STOP_SELECT' },
      { send, inject, contentScriptFiles: ['assets/content.js'] },
    )).resolves.toBe(0);

    expect(inject).not.toHaveBeenCalled();
  });
});
