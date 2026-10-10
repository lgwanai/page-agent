import type { RuntimeMessage } from '@/types/messages';
import type { RecordedPageEvent, RecordingResult } from '@/types/workflow';
import { recordingToGraph } from '@/shared/recording';
import { startRecordingInFrames } from './recording-messaging';

const SESSION_KEY = 'pageAgentRecordingSessionV1';
const COMPLETE_KEY = 'pageAgentRecordingCompleteV1';

interface RecordingSession {
  tabId: number;
  startedAt: number;
  startUrl: string;
  events: RecordedPageEvent[];
  stopping?: boolean;
}

let appendQueue: Promise<void> = Promise.resolve();

async function loadSession(): Promise<RecordingSession | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] as RecordingSession | undefined ?? null;
}

async function saveSession(session: RecordingSession | null): Promise<void> {
  if (session) await chrome.storage.session.set({ [SESSION_KEY]: session });
  else await chrome.storage.session.remove(SESSION_KEY);
}

async function sendToRecordingFrames(tabId: number, type: 'PAGE_AGENT_RECORDING_START_V2' | 'PAGE_AGENT_RECORDING_STOP_V2', startedAt: number): Promise<void> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  if (type === 'PAGE_AGENT_RECORDING_START_V2') {
    const contentScriptFiles = (chrome.runtime.getManifest().content_scripts ?? []).flatMap((entry) => entry.js ?? []);
    await startRecordingInFrames(frames ?? [{ frameId: 0 }], startedAt, {
      contentScriptFiles,
      send: (frameId, message) => chrome.tabs.sendMessage(tabId, message, { frameId }),
      inject: (frameId, files) => chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files }),
      wait: () => new Promise((resolve) => setTimeout(resolve, 100)),
    });
    return;
  }
  await Promise.all((frames ?? [{ frameId: 0 }]).map(async ({ frameId }) => {
    const message: RuntimeMessage = { type, startedAt };
    let response: { ok?: boolean; error?: string } | undefined;
    try { response = await chrome.tabs.sendMessage(tabId, message, { frameId }); }
    catch { return; /* navigated or restricted frames have no pending recorder */ }
    if (response?.ok === false && response.error) throw new Error(`录制保存失败：${response.error}`);
  }));
}

export async function startPageRecording(tab: Pick<chrome.tabs.Tab, 'id' | 'url'>): Promise<{ active: true; eventCount: 0 }> {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('请先打开一个可访问的 http/https 网页');
  const previous = await loadSession();
  if (previous) await sendToRecordingFrames(previous.tabId, 'PAGE_AGENT_RECORDING_STOP_V2', previous.startedAt);
  const session: RecordingSession = { tabId: tab.id, startedAt: Date.now(), startUrl: tab.url, events: [] };
  await chrome.storage.session.remove(COMPLETE_KEY);
  await saveSession(session);
  try {
    await sendToRecordingFrames(tab.id, 'PAGE_AGENT_RECORDING_START_V2', session.startedAt);
  } catch (error) {
    await sendToRecordingFrames(tab.id, 'PAGE_AGENT_RECORDING_STOP_V2', session.startedAt);
    await saveSession(null);
    throw error;
  }
  return { active: true, eventCount: 0 };
}

export async function appendRecordedEvent(tabId: number | undefined, frameId: number, event: Omit<RecordedPageEvent, 'target'> & { target: Omit<RecordedPageEvent['target'], 'frameId'> }, startedAt: number): Promise<void> {
  const task = appendQueue.then(async () => {
    const session = await loadSession();
    if (!session || tabId !== session.tabId || startedAt !== session.startedAt) return;
    if (session.events.some((stored) => stored.id === event.id)) return;
    session.events.push({ ...event, target: { ...event.target, frameId } });
    await saveSession(session);
    chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RECORDING_STATUS', active: true, eventCount: session.events.length } satisfies RuntimeMessage).catch(() => undefined);
  });
  appendQueue = task.catch(() => undefined);
  await task;
}

export async function stopPageRecording(tabId?: number): Promise<RecordingResult> {
  await appendQueue;
  let session = await loadSession();
  if (!session) throw new Error('当前没有正在录制的工作流');
  if (tabId !== undefined && tabId !== session.tabId) throw new Error('只能从正在录制的页面停止');
  session.stopping = true;
  await saveSession(session);
  await sendToRecordingFrames(session.tabId, 'PAGE_AGENT_RECORDING_STOP_V2', session.startedAt);
  // Content scripts acknowledge stop only after their pending event messages have drained.
  await appendQueue;
  session = await loadSession();
  if (!session) throw new Error('录制已结束');
  const result = recordingToGraph(session.startUrl, session.startedAt, Date.now(), session.events);
  await chrome.storage.session.set({ [COMPLETE_KEY]: result });
  await saveSession(null);
  chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RECORDING_COMPLETE', recording: result } satisfies RuntimeMessage).catch(() => undefined);
  return result;
}

export async function getRecordingState(): Promise<{ active: boolean; eventCount: number; recording?: RecordingResult }> {
  const [sessionValue, completeValue] = await Promise.all([
    chrome.storage.session.get(SESSION_KEY), chrome.storage.session.get(COMPLETE_KEY),
  ]);
  const session = sessionValue[SESSION_KEY] as RecordingSession | undefined;
  return {
    active: Boolean(session),
    eventCount: session?.events.length ?? 0,
    recording: completeValue[COMPLETE_KEY] as RecordingResult | undefined,
  };
}

export async function acknowledgeRecording(): Promise<void> {
  await chrome.storage.session.remove(COMPLETE_KEY);
}

export async function resumeRecordingOverlay(tabId: number): Promise<void> {
  const session = await loadSession();
  if (session?.tabId !== tabId || session.stopping) return;
  await sendToRecordingFrames(tabId, 'PAGE_AGENT_RECORDING_START_V2', session.startedAt);
}

export async function recordingForFrame(tabId: number | undefined, frameId: number): Promise<RuntimeMessage | null> {
  const session = await loadSession();
  if (!session || session.tabId !== tabId || session.stopping) return null;
  return { type: 'PAGE_AGENT_RECORDING_START_V2', startedAt: session.startedAt, showOverlay: frameId === 0 };
}
