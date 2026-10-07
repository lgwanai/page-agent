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
  options?: Array<{ value: string; label: string }>;
}

export interface EventDefinition {
  type: FriendlyEventType;
  value?: string;
  customEvent?: string;
}

interface BaseNode {
  id: string;
  name: string;
  position?: { x: number; y: number };
}

export interface StartNode extends BaseNode {
  kind: 'start';
  inputs: StartInputDeclaration[];
  targetUrl: string;
  strictValidation: boolean;
  waitForLogin: boolean;
  loadTimeoutMs: number;
  loginTimeoutMs: number;
  settleDelayMs: number;
}

export interface StartInputDeclaration {
  id: string;
  name: string;
  type: StartInputType;
  required: boolean;
  description?: string;
}

export type StartInputType = 'string' | 'number' | 'array' | 'object' | 'objectArray';

export const START_INPUT_TYPE_LABELS: Record<StartInputType, string> = {
  string: '文本',
  number: '数字',
  array: '列表',
  object: '对象',
  objectArray: '对象列表',
};

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

export interface LoopNode extends BaseNode {
  kind: 'loop';
  items: string;
  itemVariable: string;
  indexVariable: string;
  maxIterations: number;
}

export type WorkflowNode = StartNode | DomNode | AiNode | ActionNode | WaitNode | LoopNode;

export type EdgePort = 'success' | 'failure' | 'body' | 'done';

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
  verification?: ExecutionVerification;
  outputPort?: EdgePort;
}

export interface ExecutionVerification {
  ok: boolean;
  summary: string;
  expected?: unknown;
  actual?: unknown;
  evidence?: string[];
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

const TEXT_INPUT_TYPES = new Set([
  '', 'text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date', 'datetime-local',
  'month', 'time', 'week', 'color', 'range',
]);
const CLICK_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'file']);
const CLICK_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'tab', 'switch']);

/** Events a user can meaningfully perform on the selected DOM element. */
export function allowedEventsForTarget(target: PageTarget): FriendlyEventType[] {
  const tag = target.tagName.toLowerCase();
  const attributes = target.attributes ?? {};
  const inputType = (attributes.type ?? '').toLowerCase();
  const role = (attributes.role ?? '').toLowerCase();
  const contentEditable = attributes.contenteditable === '' || attributes.contenteditable === 'true';

  if (tag === 'select') return ['select', 'click', 'focus', 'blur', 'pressKey', 'hover', 'scrollIntoView', 'custom'];
  if (tag === 'textarea' || contentEditable || (tag === 'input' && TEXT_INPUT_TYPES.has(inputType))) {
    return ['input', 'click', 'focus', 'blur', 'pressKey', 'hover', 'scrollIntoView', 'custom'];
  }
  if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
    return ['check', 'click', 'focus', 'blur', 'pressKey', 'hover', 'scrollIntoView', 'custom'];
  }
  if (tag === 'form') return ['submit', 'click', 'hover', 'scrollIntoView', 'custom'];
  if (tag === 'button' || tag === 'a' || CLICK_ROLES.has(role) || (tag === 'input' && CLICK_INPUT_TYPES.has(inputType))) {
    return ['click', 'doubleClick', 'focus', 'blur', 'pressKey', 'hover', 'scrollIntoView', 'custom'];
  }
  return ['click', 'doubleClick', 'hover', 'scrollIntoView', 'custom'];
}

/** Best initial operation after a selector has been captured. */
export function defaultEventForTarget(target: PageTarget): EventDefinition {
  const allowed = allowedEventsForTarget(target);
  const type = (['select', 'check', 'input', 'submit', 'click'] as FriendlyEventType[])
    .find((candidate) => allowed.includes(candidate)) ?? allowed[0];
  return { type };
}

export const NODE_KIND_LABELS: Record<WorkflowNode['kind'], string> = {
  start: '开始', dom: '网页节点', ai: 'AI 节点', action: 'Action', wait: '等待', loop: '循环',
};

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createStartNode(id = createId('start')): StartNode {
  return {
    id,
    kind: 'start',
    name: '开始',
    inputs: [],
    targetUrl: '',
    strictValidation: false,
    waitForLogin: false,
    loadTimeoutMs: 30_000,
    loginTimeoutMs: 300_000,
    settleDelayMs: 500,
    position: { x: 60, y: 80 },
  };
}
