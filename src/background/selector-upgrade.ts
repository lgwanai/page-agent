import { structuralJson } from '@/shared/structural-json';
import { diagnosticError } from '@/shared/diagnostics';
import type { PageTarget, SelectorUpgradeReport, WorkflowNode, WorkspaceState } from '@/types/workflow';
import { readyFrame } from './frame-messaging';
import { captureFrameContext, matchesFrameUrl } from '@/shared/frame-context';
import { checkCancellation, pauseExecution } from './execution-control';
import { mutateWorkspace } from '@/shared/storage';
import { allNodes } from '@/shared/nested-graph';
import { validateTargetLocator } from '@/shared/target-locator';

type Owner = { kind: 'script' | 'action'; id: string };
type Slot = { node: WorkflowNode; inputId?: string; target: PageTarget };
function slots(nodes: WorkflowNode[]): Slot[] {
  return allNodes(nodes).flatMap(node => [
    ...('target' in node && node.target ? [{ node, target: node.target }] : []),
    ...(node.kind === 'ai' ? node.inputs.flatMap(input => input.target ? [{ node, inputId: input.id, target: input.target }] : []) : []),
  ]);
}
const same = (a: unknown, b: unknown) => structuralJson(a) === structuralJson(b);

/** Probe current documents only; numeric frame IDs are never authority for migration. */
export async function upgradeLegacyTarget(tabId: number, target: PageTarget, timeoutMs = 10000): Promise<PageTarget | undefined> {
  if (target.locator || /\{\{/.test(target.selector) || !chrome.webNavigation?.getAllFrames) return undefined;
  const evidence = ['id','name','data-testid','data-test','data-qa','aria-label','placeholder'].some(key => target.attributes?.[key])
    || (target.text && target.text.length < 160 && ['button','a','option','label','summary'].includes(target.tagName.toLowerCase()));
  // Stable generic CSS scopes (body, .rows, etc.) may intentionally match many
  // elements. Keep their semantics when no captured identity supports migration.
  if (!evidence && !/#|\[(?:id|name|data-testid|data-test|data-qa|aria-label|placeholder)=|:nth-|:first-|:last-|:only-/i.test(target.selector)) return undefined;
  const queryKeys = target.frameQueryKeys ?? (target.frameUrl ? captureFrameContext(target.frameUrl).frameQueryKeys : undefined);
  const deadline = Date.now() + timeoutMs;
  let lastError = '旧节点未在当前页面找到唯一身份；原配置未修改';
  do {
    checkCancellation();
    const frames = (await chrome.webNavigation.getAllFrames({ tabId }) ?? []).filter(frame =>
      !target.frameUrl || matchesFrameUrl(frame.url, target.frameUrl, queryKeys));
    const responses = await Promise.all(frames.map(async frame => {
      try {
        if (!await readyFrame(tabId, frame.frameId)) return undefined;
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_REPAIR_TARGET', target }, { frameId: frame.frameId, ...(frame.documentId ? { documentId: frame.documentId } : {}) });
        return { frame, response };
      } catch (error) { return { frame, response: { targetUpgrade: 1, ok: false, error: (error as Error).message } }; }
    }));
    checkCancellation();
    // readyFrame injects the matching release before probing; never execute
    // an old page listener after an unsuccessful capability negotiation.
    const supported = responses.filter(item => item?.response?.targetUpgrade === 1);
    if (frames.length && responses.some(item => item?.response && item.response.targetUpgrade !== 1)) throw new Error('页面脚本尚不支持自动升级，请重新加载插件或刷新页面；未执行操作');
    const failures = supported.filter(item => item!.response.ok === false);
    if (failures.length) throw new Error(String(failures[0]!.response.error ?? '旧节点自动修复失败'));
    const matched = supported.filter(item => item!.response.target);
    if (matched.length > 1) throw new Error('旧节点在多个 iframe 中匹配，不能自动升级；原配置未修改，也未执行操作');
    if (matched.length === 1) {
      const { frame, response } = matched[0]!;
      validateTargetLocator(response.target);
      if (!response.target.locator || response.target.tagName !== target.tagName || response.target.locator.confidence === 'low') throw new Error('页面返回的自动升级证据无效；原配置未修改');
      const next: PageTarget = { ...target, ...response.target, name: target.name, label: target.label || response.target.label, frameId: frame.frameId, frameUrl: frame.url, ...(queryKeys ? { frameQueryKeys: queryKeys } : {}) };
      next.selectorUpgrade = { version: 1, previous: structuredClone(target), upgradedAt: Date.now(), reason: '根据当前页面唯一身份自动修复并升级定位规则' };
      return next;
    }
    if (!frames.length) lastError = '旧节点的页面或业务 URL 参数不匹配；原配置未修改';
    if (Date.now() >= deadline) break;
    await pauseExecution(Math.min(250, Math.max(0, deadline - Date.now())));
  } while (true);
  throw new Error(lastError);
}

/** Keep safe per-target patches and compare against the latest graph before saving. */
export class SelectorUpgradeSession {
  readonly reports: SelectorUpgradeReport[] = [];
  private owners = new WeakMap<PageTarget, Owner>();
  private patches: Array<{ owner: Owner; report: SelectorUpgradeReport }> = [];
  register(nodes: WorkflowNode[], owner?: Owner) {
    if (owner) for (const slot of slots(nodes)) this.owners.set(slot.target, owner);
  }
  async prepare(tabId: number, node: WorkflowNode, resolvedFrameUrl?: string) {
    // Nested bodies are prepared when their individual nodes actually execute.
    const targets = slots([{ ...node, ...((node.kind === 'loop' || node.kind === 'pagination') ? { body: undefined } : {}) } as WorkflowNode]);
    for (const slot of targets) {
      if (slot.target.locator || /\{\{/.test(slot.target.selector)) continue;
      const previous = structuredClone(slot.target);
      try {
        const probe = !slot.inputId && resolvedFrameUrl && resolvedFrameUrl !== slot.target.frameUrl ? { ...slot.target, frameUrl: resolvedFrameUrl } : slot.target;
        const next = await upgradeLegacyTarget(tabId, probe);
        if (next?.selectorUpgrade) next.selectorUpgrade.previous = previous;
        if (!next) continue;
        const report: SelectorUpgradeReport = { nodeId: node.id, nodeName: node.name, inputId: slot.inputId, status: 'upgraded', reason: next.selectorUpgrade!.reason, previous, target: structuredClone(next), persisted: false };
        const owner = this.owners.get(slot.target);
        if (owner) { report.workflowId = owner.id; report.workflowKind = owner.kind; }
        this.reports.push(report);
        if (owner) this.patches.push({ owner, report });
        Object.assign(slot.target, next);
      } catch (error) {
        this.reports.push({ nodeId: node.id, nodeName: node.name, inputId: slot.inputId, status: 'unresolved', reason: (error as Error).message });
        throw diagnosticError(error, { phase: 'locating', actionDispatched: false, selector: previous.selector, nodeId: node.id, tabId });
      }
    }
  }
  async persist() {
    if (!this.patches.length) return;
    await mutateWorkspace(state => applySelectorUpgradePatches(state, this.patches));
  }
}

export function applySelectorUpgradePatches(state: WorkspaceState, patches: Array<{ owner: Owner; report: SelectorUpgradeReport }>) {
  for (const { owner, report } of patches) {
    const workflow = (owner.kind === 'script' ? state.scripts : state.actions).find(workflow => workflow.id === owner.id);
    const slot = workflow && slots(workflow.nodes).find(slot => slot.node.id === report.nodeId && slot.inputId === report.inputId);
    if (!slot || !same(slot.target, report.previous)) {
      report.persisted = false;
      report.status = 'conflict';
      report.reason = '节点在运行期间已被编辑或删除，未覆盖新配置；本次使用了已验证的定位';
      continue;
    }
    Object.assign(slot.target, structuredClone(report.target!));
    workflow!.updatedAt = Math.max(Date.now(), workflow!.updatedAt + 1);
    report.persisted = true;
  }
}
