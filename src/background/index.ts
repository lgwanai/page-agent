import type { RuntimeMessage } from '@/types/messages';
import type { WorkflowNode } from '@/types/workflow';
import { loadWorkspace, saveWorkspace } from '@/shared/storage';
import { loadProvider, saveProvider } from '@/shared/provider-storage';
import { testProvider } from './ai-provider';
import { connectBridge, getMcpConnectionInfo, isBridgeConnected, retryMcpConnection } from './bridge';
import { runAction, runGraph, runNodes, runScript } from './runner';
import { sendSelectorToFrames } from './selector-messaging';
import { acknowledgeRecording, appendRecordedEvent, getRecordingState, recordingForFrame, resumeRecordingOverlay, startPageRecording, stopPageRecording } from './recording';
import { ensureWorkflowKeys } from '@/shared/workflow-keys';
import { getInstanceId } from '@/shared/instance';
import { saveMcpOptions } from '@/shared/mcp-config';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  connectBridge();
});
chrome.runtime.onStartup.addListener(connectBridge);
connectBridge();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') void resumeRecordingOverlay(tabId).catch(() => undefined);
});
// Loading pages need a stop button before the final load-complete event too.
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId === 0) void resumeRecordingOverlay(tabId).catch(() => undefined);
});
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId === 0) void resumeRecordingOverlay(tabId).catch(() => undefined);
});

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有活动网页');
  return tab;
}

async function sendAllFrames(message: RuntimeMessage): Promise<void> {
  const tab = await getActiveTab();
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id! });
  if (message.type === 'PAGE_AGENT_START_SELECT' || message.type === 'PAGE_AGENT_STOP_SELECT') {
    const manifest = chrome.runtime.getManifest() as ReturnType<typeof chrome.runtime.getManifest> & {
      content_scripts?: Array<{ js?: string[] }>;
    };
    const contentScriptFiles = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
    await sendSelectorToFrames(frames ?? [{ frameId: 0 }], message, {
      contentScriptFiles,
      send: (frameId, selectorMessage) => chrome.tabs.sendMessage(tab.id!, selectorMessage, { frameId }),
      inject: (frameId, files) => chrome.scripting.executeScript({ target: { tabId: tab.id!, frameIds: [frameId] }, files }),
    });
    return;
  }

  await Promise.all((frames ?? [{ frameId: 0 }]).map(async ({ frameId }) => {
    try { await chrome.tabs.sendMessage(tab.id!, message, { frameId }); }
    catch { /* restricted or not-yet-loaded frames are ignored */ }
  }));
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === 'PAGE_AGENT_GET_MCP_INFO' || message.type === 'PAGE_AGENT_RECONNECT_MCP') {
    if (message.type === 'PAGE_AGENT_RECONNECT_MCP') retryMcpConnection();
    void getMcpConnectionInfo().then((result) => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_SAVE_MCP_OPTIONS') {
    void saveMcpOptions(message.options).then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_GET_INSTANCE') {
    void getInstanceId().then((instanceId) => sendResponse({ ok: true, result: { instanceId, connected: isBridgeConnected() } }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_SELECTED') {
    const frameId = sender.frameId ?? 0;
    chrome.runtime.sendMessage({ type: 'PAGE_AGENT_SELECTION', target: { ...message.target, frameId, frameUrl: sender.url ?? message.target.frameUrl } }).catch(() => undefined);
    void sendAllFrames({ type: 'PAGE_AGENT_STOP_SELECT' });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'PAGE_AGENT_START_SELECT' || message.type === 'PAGE_AGENT_STOP_SELECT') {
    void sendAllFrames(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_START_RECORDING') {
    void getActiveTab().then(startPageRecording)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RECORD_EVENT') {
    void appendRecordedEvent(sender.tab?.id, sender.frameId ?? 0, message.event, message.startedAt)
      .then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RECORDING_READY') {
    void recordingForFrame(sender.tab?.id, sender.frameId ?? 0)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_STOP_RECORDING' || message.type === 'PAGE_AGENT_STOP_RECORDING_REQUEST') {
    void stopPageRecording(message.type === 'PAGE_AGENT_STOP_RECORDING_REQUEST' ? sender.tab?.id : undefined)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_GET_RECORDING') {
    void getRecordingState().then((result) => sendResponse({ ok: true, result }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_ACK_RECORDING') {
    void acknowledgeRecording().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_GET_STATE') {
    void loadWorkspace().then(async (state) => {
      await ensureWorkflowKeys(state.scripts.map((workflow) => workflow.id));
      sendResponse({ ok: true, state });
    });
    return true;
  }
  if (message.type === 'PAGE_AGENT_SET_STATE') {
    void saveWorkspace(message.state).then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_NODES') {
    void runNodes(message.nodes as WorkflowNode[]).then((result) => sendResponse({ ok: result.ok, result }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_GRAPH') {
    const progress = message.runId ? (nodeId: string, phase: 'running' | 'completed', steps?: import('@/types/workflow').StepResult[]) => {
      void chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_PROGRESS', runId: message.runId, nodeId, phase, steps }).catch(() => undefined);
    } : undefined;
    void runGraph(message.nodes as WorkflowNode[], message.edges, message.variables, progress)
      .then((result) => sendResponse({ ok: result.ok, result }))
      .catch((error) => sendResponse({ ok: false, error: (error as Error).message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_SCRIPT') {
    void runScript(message.scriptId, message.variables).then((result) => sendResponse({ ok: result.ok, result }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_ACTION') {
    void runAction(message.actionId, message.variables).then((result) => sendResponse({ ok: result.ok, result }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_GET_PROVIDER') {
    void loadProvider().then(({ config }) => sendResponse({ ok: true, result: config }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_SAVE_PROVIDER') {
    void saveProvider(message.config, message.apiKey)
      .then((config) => sendResponse({ ok: true, result: config }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_TEST_PROVIDER') {
    void testProvider(message.config, message.apiKey)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
