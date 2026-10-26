export type FriendlyEventType =
  | 'click'
  | 'doubleClick'
  | 'input'
  | 'upload'
  | 'select'
  | 'check'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'focusin'
  | 'focusout'
  | 'mouseLeave'
  | 'change'
  | 'reset'
  | 'pressKey'
  | 'submit'
  | 'scrollIntoView'
  | 'scrollPage'
  | 'contextMenu'
  | 'longPress'
  | 'drag'
  | 'custom';

export interface LocatorCandidate {
  kind: 'id' | 'name' | 'ancestor-exact' | 'ancestor' | 'attribute' | 'text' | 'class' | 'tag' | 'position';
  selector: string; anchor?: string; match?: { kind: 'text' | 'value'; value: string }; parentFingerprint?: string;
}
export interface TargetLocator {
  version: 1; selector: string; tagName: string; inputType?: string;
  confidence: 'high' | 'medium' | 'low'; candidates: LocatorCandidate[];
}

export interface PageTarget {
  selectorUpgrade?: { version: 1; previous: PageTarget; upgradedAt: number; reason: string };
  locator?: TargetLocator;
  frameName?: string;
  name: string;
  selector: string;
  frameId: number;
  /** Stable document identity; Chrome frame IDs change after navigation. */
  frameUrl?: string;
  /** Explicit query guards; absent means legacy exact URL, present ignores unlisted runtime parameters. */
  frameQueryKeys?: string[];
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
  code?: string;
  modifiers?: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean };
  /** Recorded input defers blur to the separately recorded focus transition. */
  keepFocus?: boolean;
  relatedSelector?: string;
  /** For optional filters: empty input leaves the control untouched. */
  optionalValue?: boolean;
  /** Custom combobox option loading delay, after opening the popup. */
  minWaitMs?: number;
  maxWaitMs?: number;
}

export type RecordedTargetHint = Pick<PageTarget, 'tagName' | 'attributes' | 'text' | 'locator' | 'frameName'>;

interface BaseNode {
  id: string;
  name: string;
  position?: { x: number; y: number };
}

export interface StartNode extends BaseNode {
  kind: 'start';
  inputs: StartInputDeclaration[];
  targetUrl: string;
  /** Keep manually prepared SPA/iframe state; do not navigate or reload. */
  keepCurrentPage?: boolean;
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

export type BrowserDialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';
/** Arms handling before dispatching the trigger, then verifies the native dialog closed. */
export interface DialogNode extends BaseNode {
  kind: 'dialog';
  target: PageTarget;
  event: EventDefinition;
  dialogType: BrowserDialogType;
  action: 'accept' | 'dismiss';
  /** Empty means any message; otherwise exact text (supports variables). */
  message: string;
  promptText: string;
  timeoutMs: number;
}

export interface DomQuery {
  candidateSelector: string;
  /** Read one descendant (e.g. a table column), but return the candidate row. */
  readSelector?: string;
  normalizeWhitespace?: boolean;
  /** Optional first-N result limit, in document order. */
  maxResults?: number;
  includeRoot: boolean;
  source: 'attribute' | 'value' | 'text';
  attributeName: string;
  match: 'exists' | 'equals' | 'contains' | 'regex';
  pattern: string;
  regexFlags: string;
}

export interface QueryNode extends BaseNode {
  kind: 'query';
  target: PageTarget;
  query: DomQuery;
  /** Default keeps legacy empty-list behavior. */
  onEmpty?: 'success' | 'failure';
}

export interface OutputNode extends BaseNode {
  kind: 'output';
  source: 'text' | 'variable' | 'node' | 'dom';
  value?: string;
  sourceNodeId?: string;
  /** Optional dot path within the referenced node output. */
  path?: string;
  target?: PageTarget;
  read?: 'text' | 'value' | 'attribute';
  attributeName?: string;
  multiple?: boolean;
  /** Business outcome, independent of execution errors. */
  outcome?: 'neutral' | 'success' | 'failure';
}

export interface WatchNode extends BaseNode {
  kind: 'watch';
  target: PageTarget;
  source: 'attribute' | 'value' | 'text';
  attributeName: string;
  match: 'equals' | 'contains' | 'regex' | 'exists';
  expected: string;
  timeoutMs: number;
  intervalMs: number;
}

/** Serializable DOM snapshots, not live DOM references. */
export interface DomQueryMatch extends PageTarget {
  value: string;
  text: string;
  matchedValue: string;
  attributes: Record<string, string>;
}

export const DEFAULT_DOM_QUERY: DomQuery = {
  candidateSelector: '*', includeRoot: true, source: 'value', attributeName: '',
  match: 'exists', pattern: '', regexFlags: '',
};

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
  mode?: 'fixed' | 'random';
  minDurationMs?: number;
  maxDurationMs?: number;
}

export interface WorkflowFile { name: string; mimeType: string; base64: string }
export interface ScreenshotNode extends BaseNode {
  kind: 'screenshot';
  mode: 'viewport' | 'fullPage' | 'region';
  region?: { x: number; y: number; width: number; height: number };
  fileName: string;
}
export interface EmailNode extends BaseNode {
  kind: 'email';
  to: string;
  subject: string;
  body: string;
  attachments: string[];
}

export interface DataTableNode extends BaseNode {
  kind: 'datatable';
  target: PageTarget;
  header: 'auto' | 'firstRow' | 'none';
  parseNumbers: boolean;
  exportExcel: boolean;
  fileName: string;
}
export interface TableFillStructure {
  headerSelector?: string;
  rowSelector?: string;
  cellSelector?: string;
}
export interface TableFillNode extends BaseNode {
  kind: 'tableFill';
  target: PageTarget;
  data: string;
  keyColumns: string[];
  skipUnmatchedRows: boolean;
  structure?: TableFillStructure;
}
export interface DataTableOutput {
  type: 'datatable';
  columns: string[];
  rows: Record<string, string | number>[];
  values: Array<Array<string | number>>;
  rowCount: number;
  excel?: { type: 'files'; files: WorkflowFile[] };
}

export interface LoopNode extends BaseNode {
  kind: 'loop';
  items: string;
  itemVariable: string;
  indexVariable: string;
  maxIterations: number;
  /** Absent only for legacy external body/back-edge loops. */
  body?: WorkflowBody;
}

export interface WorkflowBody {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId?: string;
}

export interface PaginationNode extends BaseNode {
  kind: 'pagination';
  target: PageTarget;
  mode: 'goto' | 'all';
  page: string;
  pageVariable: string;
  /** Absent means traverse to the last page. Inclusive, supports variables. */
  stopAtPage?: string;
  /** Stop after a successful body when this exact variable reference has a nonempty result. */
  stopWhen?: string;
  maxPages: number;
  timeoutMs: number;
  settleMs: number;
  body: WorkflowBody;
}

export interface PaginationState {
  page: number;
  totalPages?: number;
  hasNext: boolean | null;
}

export interface CalendarNode extends BaseNode {
  kind: 'calendar';
  target: PageTarget;
  date: string;
  endDate: string;
  mode: 'single' | 'range';
}
export interface RequestNode extends BaseNode {
  kind: 'request';
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  /** JSON object whose string values may reference workflow variables. */
  headers: string;
  body: string;
  responseType: 'text' | 'json';
  timeoutMs: number;
}

export type WorkflowNode = StartNode | DomNode | DialogNode | QueryNode | OutputNode | WatchNode | ScreenshotNode | DataTableNode | TableFillNode | EmailNode | CalendarNode | PaginationNode | AiNode | ActionNode | WaitNode | LoopNode | RequestNode;

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
  tags?: string[];
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

/** ScriptDefinition is kept as a storage/API compatibility name. In the UI it is a workflow. */
export type WorkflowDefinition = ScriptDefinition;

export interface RecordedPageEvent {
  id: string;
  timestamp: number;
  url: string;
  target: PageTarget;
  event: EventDefinition;
}

export interface RecordingResult {
  startedAt: number;
  stoppedAt: number;
  startUrl: string;
  eventCount: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowExportFile {
  $schema: 'https://page-agent.dev/schemas/workflow-v1.json';
  schemaVersion: 1;
  kind: 'page-agent-workflow';
  exportedAt: string;
  workflow: WorkflowDefinition;
}

export interface WorkspaceState {
  trash?: Array<{ workflow: ScriptDefinition; deletedAt: number }>;
  actions: ActionDefinition[];
  scripts: ScriptDefinition[];
  draft: WorkflowNode[];
  draftEdges: WorkflowEdge[];
}

export interface StepResult {
  ok: boolean;
  nodeId: string;
  message: string;
  diagnostic?: import('@/shared/diagnostics').Diagnostic;
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

export interface SelectorUpgradeReport {
  nodeId: string; nodeName: string; inputId?: string; workflowId?: string; workflowKind?: 'script' | 'action';
  status: 'upgraded' | 'unresolved' | 'conflict';
  reason: string; previous?: PageTarget; target?: PageTarget; persisted?: boolean;
}
export interface RunResult {
  selectorUpgrades?: SelectorUpgradeReport[];
  historyWarning?: string;
  cancelled?: boolean;
  runId?: string;
  ok: boolean;
  steps: StepResult[];
  /** Last executed Output value; outputs preserves every named Output value. */
  output?: unknown;
  outputs?: Record<string, unknown>;
  businessOk?: boolean;
  error?: string;
  diagnostic?: import('@/shared/diagnostics').Diagnostic;
}

export const EVENT_LABELS: Record<FriendlyEventType, string> = {
  click: '点击',
  doubleClick: '双击',
  input: '输入内容',
  upload: '上传文件',
  select: '选择选项',
  check: '勾选 / 取消勾选',
  hover: '鼠标悬停',
  focus: '聚焦',
  blur: '失去焦点',
  focusin: '进入焦点（focusin）',
  focusout: '离开焦点（focusout）',
  mouseLeave: '鼠标移出',
  change: '触发变更（change）',
  reset: '重置表单',
  pressKey: '按键',
  submit: '提交表单',
  scrollIntoView: '滚动到节点',
  scrollPage: '滚动页面 / 区域',
  contextMenu: '右键点击',
  longPress: '长按',
  drag: '拖拽移动',
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
  const contentEditable = attributes.contenteditable === '' || attributes.contenteditable === 'true' || attributes.contenteditable === 'plaintext-only';
  const withRecordedScroll = (events: FriendlyEventType[]): FriendlyEventType[] => {
    const expanded = [...events, 'mouseLeave', 'change', 'drag'] as FriendlyEventType[];
    if (events.includes('focus') || attributes.tabindex !== undefined) expanded.push('focus', 'blur', 'focusin', 'focusout', 'pressKey');
    if (attributes._pageAgentScrollable === 'true') expanded.unshift('scrollPage');
    return [...new Set(expanded)];
  };

  if (tag === 'input' && inputType === 'file') return withRecordedScroll(['upload', 'click', 'focus', 'blur', 'scrollIntoView', 'custom']);
  if (tag === 'html' || tag === 'body') return ['scrollPage', 'click', 'contextMenu', 'custom'];
  if (tag === 'select' || role === 'combobox') return withRecordedScroll(['select', 'click', 'focus', 'blur', 'pressKey', 'hover', 'contextMenu', 'longPress', 'scrollIntoView', 'custom']);
  if (tag === 'textarea' || contentEditable || (tag === 'input' && TEXT_INPUT_TYPES.has(inputType))) {
    return withRecordedScroll(['input', 'click', 'focus', 'blur', 'pressKey', 'hover', 'contextMenu', 'longPress', 'scrollIntoView', 'custom']);
  }
  if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
    return withRecordedScroll(['check', 'click', 'focus', 'blur', 'pressKey', 'hover', 'contextMenu', 'longPress', 'scrollIntoView', 'custom']);
  }
  if (tag === 'form') return withRecordedScroll(['submit', 'reset', 'click', 'hover', 'contextMenu', 'longPress', 'scrollIntoView', 'custom']);
  if (tag === 'button' || tag === 'a' || CLICK_ROLES.has(role) || (tag === 'input' && CLICK_INPUT_TYPES.has(inputType))) {
    return withRecordedScroll(['click', 'upload', 'doubleClick', 'focus', 'blur', 'pressKey', 'hover', 'contextMenu', 'longPress', 'scrollIntoView', 'custom']);
  }
  return withRecordedScroll(['click', 'upload', 'doubleClick', 'hover', 'contextMenu', 'longPress', 'scrollIntoView', 'custom']);
}

/** Best initial operation after a selector has been captured. */
export function defaultEventForTarget(target: PageTarget): EventDefinition {
  const allowed = allowedEventsForTarget(target);
  const type = ((target.tagName.toLowerCase() === 'input' && target.attributes?.type?.toLowerCase() === 'file' ? ['upload'] : ['select', 'check', 'input', 'submit', 'click']) as FriendlyEventType[])
    .find((candidate) => allowed.includes(candidate)) ?? allowed[0];
  return { type };
}

export const NODE_KIND_LABELS: Record<WorkflowNode['kind'], string> = {
  start: '开始', dialog: '浏览器弹窗', dom: '网页操作', query: '检索', output: '输出', watch: '监控', screenshot: '截图', datatable: '数据表', tableFill: '表格填充', email: '发送邮件', calendar: '日历选择器', pagination: '分页', ai: '智能分析', action: '调用流程', wait: '等待', loop: '循环', request: '请求',
};

export const NODE_KIND_ENGLISH: Record<WorkflowNode['kind'], string> = {
  start: 'Start', dom: 'Selector', dialog: 'Browser Dialog', query: 'Query', output: 'Output', watch: 'Watch', screenshot: 'Screenshot', datatable: 'DataTable', tableFill: 'Table Fill', email: 'Email', calendar: 'Calendar', pagination: 'Pagination', ai: 'AI', action: 'Action', wait: 'Wait', loop: 'Loop', request: 'HTTP Request',
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
    keepCurrentPage: false,
    strictValidation: false,
    waitForLogin: false,
    loadTimeoutMs: 30_000,
    loginTimeoutMs: 300_000,
    settleDelayMs: 500,
    position: { x: 60, y: 80 },
  };
}
