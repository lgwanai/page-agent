// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '@/types/messages';
import type { RecordedPageEvent } from '@/types/workflow';
import { appendRecordedEvent, getRecordingState, recordingForFrame, resumeRecordingOverlay, startPageRecording, stopPageRecording } from './recording';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const tab = { id: 10, url: 'https://cn.bing.com/' };
let storage: Record<string, unknown>;
let listeners: Listener[];
let inject = vi.fn<[], Promise<unknown[]>>();

function pageEvent(id: string): Omit<RecordedPageEvent, 'target'> & { target: Omit<RecordedPageEvent['target'], 'frameId'> } {
  return { id, timestamp: Date.now(), url: tab.url, target: { name: '', selector: '#query', tagName: 'input', label: '搜索框' }, event: { type: 'click' } };
}

beforeEach(() => {
  vi.resetModules();
  storage = {};
  listeners = [];
  inject = vi.fn(async (): Promise<unknown[]> => { await import('../content/index'); return []; });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('chrome', {
    storage: { session: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] ? JSON.parse(JSON.stringify(storage[key])) : undefined })),
      set: vi.fn(async (value: Record<string, unknown>) => Object.assign(storage, JSON.parse(JSON.stringify(value)))),
      remove: vi.fn(async (key: string) => { delete storage[key]; }),
    } },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0 }]) },
    scripting: { executeScript: inject },
    tabs: { sendMessage: vi.fn(async (_tabId: number, message: RuntimeMessage) => {
      if (!listeners.length) throw new Error('Receiving end does not exist');
      return new Promise((resolve) => {
        const listener = listeners.at(-1)! as (...args: Parameters<Listener>) => boolean | void;
        if (!listener(message, {}, resolve)) resolve(undefined);
      });
    }) },
    runtime: {
      getManifest: () => ({ content_scripts: [{ js: ['assets/content-loader.js'] }] }),
      onMessage: {
        addListener: (listener: Listener) => listeners.push(listener),
        removeListener: (listener: Listener) => { listeners = listeners.filter((item) => item !== listener); },
      },
      sendMessage: vi.fn(async (message: RuntimeMessage) => {
        if (message.type === 'PAGE_AGENT_RECORD_EVENT') {
          await appendRecordedEvent(tab.id, 0, message.event, message.startedAt);
          return { ok: true };
        }
        if (message.type === 'PAGE_AGENT_RECORDING_READY') return { ok: true, result: await recordingForFrame(tab.id, 0) };
        return { ok: true };
      }),
    },
  });
});

afterEach(() => {
  const contentWindow = window as Window & { __pageAgentLoaded?: boolean; __pageAgentInstallation?: { dispose: () => void } };
  contentWindow.__pageAgentInstallation?.dispose();
  delete contentWindow.__pageAgentInstallation;
  delete contentWindow.__pageAgentLoaded;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('recording content/background integration', () => {
  it('injects into an already-open page and saves the complete WorkBuddy search on immediate stop', async () => {
    // A previous extension version used only this guard, with no recording receiver.
    (window as Window & { __pageAgentLoaded?: boolean }).__pageAgentLoaded = true;
    document.body.innerHTML = '<form id="search"><textarea id="query" name="q"></textarea></form>';
    await startPageRecording(tab);
    expect(inject).toHaveBeenCalledOnce();
    const field = document.querySelector<HTMLTextAreaElement>('#query')!;
    const form = document.querySelector<HTMLFormElement>('#search')!;
    form.addEventListener('submit', (event) => event.preventDefault());
    field.addEventListener('keydown', () => form.requestSubmit());
    field.click();
    field.value = 'WorkBuddy';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const result = await stopPageRecording();
    expect(result.nodes).toHaveLength(4);
    expect(result.nodes.slice(1)).toMatchObject([
      { event: { type: 'click' } }, { event: { type: 'input', value: 'WorkBuddy' } }, { event: { type: 'pressKey', value: 'Enter' } },
    ]);
    expect((await getRecordingState()).active).toBe(false);
  });

  it('does not duplicate listeners when page-load completion resumes the same session', async () => {
    document.body.innerHTML = '<button id="query">搜索</button>';
    await startPageRecording(tab);
    await resumeRecordingOverlay(tab.id);
    document.querySelector<HTMLButtonElement>('#query')!.click();
    const result = await stopPageRecording();
    expect(result.eventCount).toBe(1);
    expect(listeners).toHaveLength(1);
  });

  it('restores UI on SPA repaint without duplicating recorded operations', async () => {
    await startPageRecording(tab);
    document.documentElement.innerHTML = '<head></head><body><button id="query">跳转后页面</button></body>';
    await resumeRecordingOverlay(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelectorAll('#__page_agent_recording__')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('#query')!.click();
    expect((await stopPageRecording()).eventCount).toBe(1);
    expect(document.querySelector('#__page_agent_recording__')).toBeNull();
  });

  it('resynchronizes BFCache pages and removes stale UI when the session has ended', async () => {
    await startPageRecording(tab);
    expect(document.querySelector('#__page_agent_recording__')).not.toBeNull();
    delete storage.pageAgentRecordingSessionV1;
    window.dispatchEvent(new Event('pageshow'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('#__page_agent_recording__')).toBeNull();
  });

  it('keeps events when a new page document rejoins the recording', async () => {
    await startPageRecording(tab);
    const startMessage = await recordingForFrame(tab.id, 0);
    expect(startMessage?.type).toBe('PAGE_AGENT_RECORDING_START_V2');
    if (startMessage?.type !== 'PAGE_AGENT_RECORDING_START_V2') throw new Error('No recording');
    await appendRecordedEvent(tab.id, 0, pageEvent('before-navigation'), startMessage.startedAt);
    const installation = (window as Window & { __pageAgentInstallation?: { dispose: () => void } });
    installation.__pageAgentInstallation?.dispose();
    delete installation.__pageAgentInstallation;
    document.body.innerHTML = '<button id="query">结果页</button>';
    vi.resetModules();
    await import('../content/index');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelectorAll('#__page_agent_recording__')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('#query')!.click();
    expect((await stopPageRecording()).eventCount).toBe(2);
  });

  it('rolls back the session when the page cannot start recording', async () => {
    inject.mockRejectedValue(new Error('Cannot inject into page'));
    await expect(startPageRecording(tab)).rejects.toThrow('网页录制未启动');
    expect((await getRecordingState()).active).toBe(false);
  });

  it('preserves simultaneous event messages and ignores stale-session messages', async () => {
    await startPageRecording(tab);
    const startMessage = await recordingForFrame(tab.id, 0);
    if (startMessage?.type !== 'PAGE_AGENT_RECORDING_START_V2') throw new Error('No recording');
    await Promise.all([
      appendRecordedEvent(tab.id, 0, pageEvent('first'), startMessage.startedAt),
      appendRecordedEvent(tab.id, 0, pageEvent('second'), startMessage.startedAt),
      appendRecordedEvent(tab.id, 0, pageEvent('stale'), 0),
    ]);
    expect((await stopPageRecording()).eventCount).toBe(2);
  });
});
