export type FriendlyEventType =
  | 'click'
  | 'doubleClick'
  | 'input'
  | 'select'
  | 'check'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'pressKey'
  | 'submit'
  | 'scrollIntoView'
  | 'custom';

export interface PageTarget {
  name: string;
  selector: string;
  frameId: number;
  tagName: string;
  label: string;
  text?: string;
  attributes?: Record<string, string>;
}

export interface EventDefinition {
  type: FriendlyEventType;
  value?: string;
  customEvent?: string;
}

interface BaseNode {
  id: string;
  name: string;
  continueOnError?: boolean;
  position?: { x: number; y: number };
}

export interface DomNode extends BaseNode {
  kind: 'dom';
  target: PageTarget;
  event: EventDefinition;
}

export interface AiNode extends BaseNode {
  kind: 'ai';
  instruction: string;
  event: EventDefinition;
  scopeSelector?: string;
  actionId?: string;
  inputs: AiInputBinding[];
}

export type AiInputType = 'selector' | 'node' | 'literal';

export interface AiInputBinding {
  id: string;
  name: string;
  type: AiInputType;
  target?: PageTarget;
  sourceNodeId?: string;
  value?: string;
  multiple?: boolean;
  attribute?: 'text' | 'value' | 'html' | 'attributes';
}

export interface ActionNode extends BaseNode {
  kind: 'action';
  actionId: string;
}

export interface WaitNode extends BaseNode {
  kind: 'wait';
  durationMs: number;
}

export type ConditionOperator = 'equals' | 'notEquals' | 'contains' | 'exists' | 'greaterThan' | 'lessThan';

export interface ConditionNode extends BaseNode {
  kind: 'condition';
  left: string;
  operator: ConditionOperator;
  right?: string;
}

export interface LoopNode extends BaseNode {
  kind: 'loop';
  items: string;
  itemVariable: string;
  indexVariable: string;
  maxIterations: number;
}

export type WorkflowNode = DomNode | AiNode | ActionNode | WaitNode | ConditionNode | LoopNode;

export type EdgePort = 'success' | 'failure' | 'true' | 'false' | 'body' | 'done';

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: EdgePort;
}

export interface ActionDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface ScriptDefinition {
  id: string;
  name: string;
  description?: string;
  urlPattern?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
}

export interface WorkspaceState {
  actions: ActionDefinition[];
  scripts: ScriptDefinition[];
  draft: WorkflowNode[];
  draftEdges: WorkflowEdge[];
}

export interface StepResult {
  ok: boolean;
  nodeId: string;
  message: string;
  data?: unknown;
  outputPort?: EdgePort;
}

export interface RunResult {
  ok: boolean;
  steps: StepResult[];
  error?: string;
}

export const EVENT_LABELS: Record<FriendlyEventType, string> = {
  click: '点击',
  doubleClick: '双击',
  input: '输入内容',
  select: '选择选项',
  check: '勾选 / 取消勾选',
  hover: '鼠标悬停',
  focus: '聚焦',
  blur: '失去焦点',
  pressKey: '按键',
  submit: '提交表单',
  scrollIntoView: '滚动到节点',
  custom: '自定义 Web 事件',
};

export const NODE_KIND_LABELS: Record<WorkflowNode['kind'], string> = {
  dom: '网页节点', ai: 'AI 节点', action: 'Action', wait: '等待', condition: '条件分支', loop: '循环',
};

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
