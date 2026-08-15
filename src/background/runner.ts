import { loadWorkspace, saveWorkspace } from '@/shared/storage';
import type { ActionDefinition, RunResult, StepResult, WorkflowNode } from '@/types/workflow';

type Variables = Record<string, string>;

function interpolate(value: string | undefined, variables: Variables): string | undefined {
  return value?.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => variables[key] ?? '');
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有可操作的活动网页');
  if (!/^https?:/i.test(tab.url ?? '')) throw new Error('Page Agent 只能操作 http/https 网页');
  return tab.id;
}

async function sendToFrame(tabId: number, frameId: number, message: unknown): Promise<Record<string, unknown>> {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId }) as Record<string, unknown>;
  } catch {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    if (!files.length) throw new Error('插件页面脚本不可用，请刷新网页后重试');
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
    return await chrome.tabs.sendMessage(tabId, message, { frameId }) as Record<string, unknown>;
  }
}

async function runSingleNode(
  tabId: number,
  node: WorkflowNode,
  actions: ActionDefinition[],
  variables: Variables,
  stack: string[],
): Promise<StepResult[]> {
  if (node.kind === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(node.durationMs, 60_000))));
    return [{ ok: true, nodeId: node.id, message: `等待 ${node.durationMs}ms` }];
  }
  if (node.kind === 'action') {
    if (stack.includes(node.actionId)) throw new Error(`Action 循环调用：${[...stack, node.actionId].join(' → ')}`);
    const action = actions.find((item) => item.id === node.actionId);
    if (!action) throw new Error(`Action 不存在：${node.actionId}`);
    return runNodesInternal(tabId, action.nodes, actions, variables, [...stack, node.actionId]);
  }
  const event = { ...node.event, value: interpolate(node.event.value, variables) };
  const response = node.kind === 'dom'
    ? await sendToFrame(tabId, node.target.frameId ?? 0, {
        type: 'PAGE_AGENT_EXECUTE_EVENT', selector: interpolate(node.target.selector, variables), event,
      })
    : await sendToFrame(tabId, 0, {
        type: 'PAGE_AGENT_EXECUTE_AI', instruction: interpolate(node.instruction, variables),
        scopeSelector: interpolate(node.scopeSelector, variables), event,
      });
  if (!response?.ok) throw new Error(String(response?.error ?? '页面执行失败'));
  const results: StepResult[] = [{ ok: true, nodeId: node.id, message: `${node.name}执行成功`, data: response.data }];
  if (node.kind === 'ai' && node.actionId) {
    const nested = actions.find((item) => item.id === node.actionId);
    if (!nested) throw new Error(`AI 节点关联 Action 不存在：${node.actionId}`);
    results.push(...await runNodesInternal(tabId, nested.nodes, actions, variables, [...stack, node.actionId]));
  }
  return results;
}

async function runNodesInternal(
  tabId: number,
  nodes: WorkflowNode[],
  actions: ActionDefinition[],
  variables: Variables,
  stack: string[] = [],
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const node of nodes) {
    try {
      results.push(...await runSingleNode(tabId, node, actions, variables, stack));
    } catch (error) {
      results.push({ ok: false, nodeId: node.id, message: (error as Error).message });
      if (!node.continueOnError) throw Object.assign(error as Error, { results });
    }
  }
  return results;
}

export async function runNodes(nodes: WorkflowNode[], variables: Variables = {}): Promise<RunResult> {
  const tabId = await activeTabId();
  const { actions } = await loadWorkspace();
  try {
    const steps = await runNodesInternal(tabId, nodes, actions, variables);
    return { ok: steps.every((step) => step.ok), steps };
  } catch (error) {
    const steps = (error as Error & { results?: StepResult[] }).results ?? [];
    return { ok: false, steps, error: (error as Error).message };
  }
}

export async function runScript(scriptId: string, variables: Variables = {}): Promise<RunResult> {
  const state = await loadWorkspace();
  const script = state.scripts.find((item) => item.id === scriptId || item.name === scriptId);
  if (!script) return { ok: false, steps: [], error: `Script 不存在：${scriptId}` };
  const result = await runNodes(script.nodes, variables);
  script.lastRunAt = Date.now();
  await saveWorkspace(state);
  return result;
}

export async function runAction(actionId: string, variables: Variables = {}): Promise<RunResult> {
  const state = await loadWorkspace();
  const action = state.actions.find((item) => item.id === actionId || item.name === actionId);
  if (!action) return { ok: false, steps: [], error: `Action 不存在：${actionId}` };
  return runNodes(action.nodes, variables);
}
