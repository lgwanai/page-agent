import { cancelExecution, executionStatus } from './execution-control';
import type { RuntimeMessage } from '@/types/messages';
import type { WorkflowNode } from '@/types/workflow';
import { loadWorkspace, replaceWorkspace, renameWorkflow, deleteWorkflow, restoreWorkflow, updateWorkflowTags, purgeWorkflow } from '@/shared/storage';
import { loadProvider, saveProvider } from '@/shared/provider-storage';
import { testProvider } from './ai-provider';
import { connectBridge, getMcpConnectionInfo, isBridgeConnected, retryMcpConnection } from './bridge';
import { runAction, runGraph, runNodes, runScript } from './runner';
import { sendSelectorToFrames } from './selector-messaging';
import { selectedPageTarget } from './selection-target';
import { acknowledgeRecording, appendRecordedEvent, getRecordingState, recordingForFrame, resumeRecordingOverlay, startPageRecording, stopPageRecording } from './recording';
import { ensureWorkflowKeys, ensureWorkflowKey, rotateWorkflowKey } from '@/shared/workflow-keys';
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
  if (message.type === 'PAGE_AGENT_START_SELECT' && !/^https?:\/\//i.test(tab.url ?? '')) throw new Error(`Selector 需要在目标 http/https 网页上启动，当前页面是 ${tab.url ?? '未知网址'}；请切换回目标网页后再点击 Selector`);
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
  if (message.type === 'PAGE_AGENT_COMPONENT_VERSIONS') {
    void getActiveTab().then(async tab => {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id! });
      return Promise.all((frames ?? []).map(async frame => {
        try {
          const response = await Promise.race([chrome.tabs.sendMessage(tab.id!, { type: 'PAGE_AGENT_PING' }, { frameId: frame.frameId }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('握手超时')), 2000))]);
          return { frameId: frame.frameId, version: response?.contentVersion };
        } catch { return { frameId: frame.frameId, error: '页面脚本未连接，请刷新网页' }; }
      }));
    }).then(result => sendResponse({ ok: true, result })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_EXECUTION_STATUS') { sendResponse({ ok: true, result: executionStatus() }); return false; }
  if (message.type === 'PAGE_AGENT_CANCEL_RUN') { sendResponse({ ok: cancelExecution(message.runId) }); return false; }
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
    chrome.runtime.sendMessage({ type: 'PAGE_AGENT_SELECTION', target: selectedPageTarget(message.target, sender) }).catch(() => undefined);
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
  if (message.type === 'PAGE_AGENT_PICK_SCREENSHOT_REGION') {
    void getActiveTab().then(async (tab) => {
      if (!/^https?:\/\//i.test(tab.url ?? '')) throw new Error('请切回目标网页后框选截图');
      const { readyFrame } = await import('./frame-messaging');
      if (!await readyFrame(tab.id!,0)) throw new Error('页面脚本未就绪，请刷新页面');
      return chrome.tabs.sendMessage(tab.id!,message,{frameId:0});
    }).then(sendResponse).catch((error:Error)=>sendResponse({ok:false,error:error.message}));
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
    void replaceWorkspace(message.state, message.expectedRevisions).then(async () => sendResponse({ ok: true, state: await loadWorkspace() }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_WORKFLOW_KEY') {
    void loadWorkspace().then(state => {
      if (!state.scripts.some(item => item.id === message.workflowId)) throw new Error('工作流不存在');
      return message.rotate ? rotateWorkflowKey(message.workflowId) : ensureWorkflowKey(message.workflowId);
    }).then(result => sendResponse({ ok: true, result })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if ((message.type === 'PAGE_AGENT_PURGE_WORKFLOW' || message.type === 'PAGE_AGENT_DELETE_WORKFLOW') && executionStatus()) { sendResponse({ ok: false, error: '请先停止当前运行，再删除工作流' }); return false; }
  if (message.type === 'PAGE_AGENT_PURGE_WORKFLOW') {
    void purgeWorkflow(message.workflowId).then(() => sendResponse({ ok: true })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RESTORE_WORKFLOW' || message.type === 'PAGE_AGENT_TAG_WORKFLOW') {
    void (message.type === 'PAGE_AGENT_RESTORE_WORKFLOW' ? restoreWorkflow(message.workflowId) : updateWorkflowTags(message.workflowId, message.tags, message.expectedUpdatedAt))
      .then(() => sendResponse({ ok: true })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_DELETE_WORKFLOW') {
    void deleteWorkflow(message.workflowId, message.expectedUpdatedAt)
      .then(async () => sendResponse({ ok: true, state: await loadWorkspace() }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RENAME_WORKFLOW') {
    void renameWorkflow(message.workflowId, message.name, message.expectedUpdatedAt)
      .then(result => sendResponse({ ok: true, result }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_NODES') {
    void runNodes(message.nodes as WorkflowNode[]).then((result) => sendResponse({ ok: result.ok, result })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_GRAPH') {
    const progress = message.runId ? (nodeId: string, phase: 'running' | 'completed', steps?: import('@/types/workflow').StepResult[]) => {
      void chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_PROGRESS', runId: message.runId, nodeId, phase, steps }).catch(() => undefined);
    } : undefined;
    void loadWorkspace().then(state => {
      const workflow = message.workflowId ? state.scripts.find(item => item.id === message.workflowId) : undefined;
      if (message.workflowId && !workflow) throw new Error('工作流已删除，请先恢复后再运行');
      return runGraph(message.nodes as WorkflowNode[], message.edges, message.variables, progress, workflow ? { id: workflow.id, name: `${workflow.name}（画布调试）` } : undefined);
    })
      .then((result) => sendResponse({ ok: result.ok, result }))
      .catch((error) => sendResponse({ ok: false, error: (error as Error).message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_SCRIPT') {
    void runScript(message.scriptId, message.variables).then((result) => sendResponse({ ok: result.ok, result })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'PAGE_AGENT_RUN_ACTION') {
    void runAction(message.actionId, message.variables).then((result) => sendResponse({ ok: result.ok, result })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
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
