import type { RuntimeMessage } from '@/types/messages';
import type { WorkflowNode } from '@/types/workflow';
import { loadWorkspace, saveWorkspace } from '@/shared/storage';
import { loadProvider, saveProvider } from '@/shared/provider-storage';
import { testProvider } from './ai-provider';
import { connectBridge } from './bridge';
import { runAction, runGraph, runNodes, runScript } from './runner';
import { sendSelectorToFrames } from './selector-messaging';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  connectBridge();
});
chrome.runtime.onStartup.addListener(connectBridge);
connectBridge();

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
  if (message.type === 'PAGE_AGENT_SELECTED') {
    const frameId = sender.frameId ?? 0;
    chrome.runtime.sendMessage({ type: 'PAGE_AGENT_SELECTION', target: { ...message.target, frameId } }).catch(() => undefined);
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
  if (message.type === 'PAGE_AGENT_GET_STATE') {
    void loadWorkspace().then((state) => sendResponse({ ok: true, state }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_SET_STATE') {
    void saveWorkspace(message.state).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_NODES') {
    void runNodes(message.nodes as WorkflowNode[]).then((result) => sendResponse({ ok: result.ok, result }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_GRAPH') {
    void runGraph(message.nodes as WorkflowNode[], message.edges, message.variables).then((result) => sendResponse({ ok: result.ok, result }));
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
