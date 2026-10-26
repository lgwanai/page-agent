import type { AiProviderConfig } from './provider';
import type { McpClientOptions } from './mcp';
import type { DomQuery, EventDefinition, PageTarget, RecordedPageEvent, RecordedTargetHint, RecordingResult, RunResult, StepResult, WorkflowEdge, WorkspaceState } from './workflow';

export type RuntimeMessage =
  | { type: 'PAGE_AGENT_REPAIR_TARGET'; target: PageTarget }
  | { type: 'PAGE_AGENT_PREPARE_UPLOAD'; selector: string }
  | { type: 'PAGE_AGENT_VALIDATE_UPLOAD' | 'PAGE_AGENT_VERIFY_UPLOAD'; selector: string; token: string; files: import('@/shared/upload').UploadFileInfo[] }
  | { type: 'PAGE_AGENT_RELEASE_UPLOAD'; token: string }
  | { type: 'PAGE_AGENT_COMPONENT_VERSIONS' }
  | { type: 'PAGE_AGENT_RESTORE_WORKFLOW'; workflowId: string }
  | { type: 'PAGE_AGENT_PURGE_WORKFLOW'; workflowId: string }
  | { type: 'PAGE_AGENT_TAG_WORKFLOW'; workflowId: string; tags: string[]; expectedUpdatedAt: number }
  | { type: 'PAGE_AGENT_WORKFLOW_KEY'; workflowId: string; rotate?: boolean }
  | { type: 'PAGE_AGENT_EXECUTION_STATUS' }
  | { type: 'PAGE_AGENT_CANCEL_RUN'; runId: string }
  | { type: 'PAGE_AGENT_READ_OUTPUT'; selector: string; read: 'text' | 'value' | 'attribute'; attributeName?: string; multiple?: boolean }
  | { type: 'PAGE_AGENT_FILL_TABLE'; selector: string; data: unknown; keyColumns: string[]; skipUnmatchedRows: boolean; structure?: import('./workflow').TableFillStructure }
  | { type: 'PAGE_AGENT_READ_DATATABLE'; selector: string; header: 'auto' | 'firstRow' | 'none'; parseNumbers: boolean }
  | { type: 'PAGE_AGENT_PICK_SCREENSHOT_REGION' }
  | { type: 'PAGE_AGENT_SCREENSHOT_CONTROL'; operation: 'begin' | 'scroll' | 'end' | 'info'; token: string; selector?: string; x?: number; y?: number; hideFixed?: boolean; settleMs?: number }
  | { type: 'PAGE_AGENT_INSPECT_PAGE'; selector: string; maxNodes?: number; maxText?: number }
  | { type: 'PAGE_AGENT_PING' }
  | { type: 'PAGE_AGENT_LOCATE_SELECTOR'; selector: string; targetHint?: RecordedTargetHint }
  | { type: 'PAGE_AGENT_START_SELECT'; exactElement?: boolean }
  | { type: 'PAGE_AGENT_STOP_SELECT' }
  | { type: 'PAGE_AGENT_START_RECORDING' }
  | { type: 'PAGE_AGENT_RECORDING_START_V2'; startedAt: number; showOverlay: boolean }
  | { type: 'PAGE_AGENT_RECORDING_STOP_V2'; startedAt: number }
  | { type: 'PAGE_AGENT_RECORDING_READY' }
  | { type: 'PAGE_AGENT_STOP_RECORDING' }
  | { type: 'PAGE_AGENT_STOP_RECORDING_REQUEST' }
  | { type: 'PAGE_AGENT_RECORD_EVENT'; startedAt: number; event: Omit<RecordedPageEvent, 'target'> & { target: Omit<PageTarget, 'frameId'> } }
  | { type: 'PAGE_AGENT_GET_RECORDING' }
  | { type: 'PAGE_AGENT_ACK_RECORDING' }
  | { type: 'PAGE_AGENT_RECORDING_STATUS'; active: boolean; eventCount: number }
  | { type: 'PAGE_AGENT_RECORDING_COMPLETE'; recording: RecordingResult }
  | { type: 'PAGE_AGENT_SELECTED'; target: Omit<PageTarget, 'frameId'> }
  | { type: 'PAGE_AGENT_SELECTION'; target: PageTarget }
  | { type: 'PAGE_AGENT_EXECUTE_EVENT'; selector: string; event: EventDefinition; targetHint?: RecordedTargetHint }
  | { type: 'PAGE_AGENT_EXECUTE_AI'; instruction: string; event: EventDefinition; scopeSelector?: string }
  | { type: 'PAGE_AGENT_READ_SELECTOR'; selector: string; multiple?: boolean; attribute?: string }
  | { type: 'PAGE_AGENT_QUERY_DOM'; selector: string; query: DomQuery }
  | { type: 'PAGE_AGENT_SELECT_DATE'; selector: string; date: string; endDate?: string }
  | { type: 'PAGE_AGENT_PAGINATION'; selector: string; page?: number; timeoutMs?: number; settleMs?: number; maxSteps?: number }
  | { type: 'PAGE_AGENT_RUN_NODES'; nodes: unknown[] }
  | { type: 'PAGE_AGENT_RUN_GRAPH'; nodes: unknown[]; edges: WorkflowEdge[]; variables?: Record<string, unknown>; runId?: string; workflowId?: string }
  | { type: 'PAGE_AGENT_RUN_PROGRESS'; runId: string; nodeId: string; phase: 'running' | 'completed'; steps?: StepResult[] }
  | { type: 'PAGE_AGENT_RUN_SCRIPT'; scriptId: string; variables?: Record<string, unknown> }
  | { type: 'PAGE_AGENT_RUN_ACTION'; actionId: string; variables?: Record<string, unknown> }
  | { type: 'PAGE_AGENT_GET_STATE' }
  | { type: 'PAGE_AGENT_DELETE_WORKFLOW'; workflowId: string; expectedUpdatedAt: number }
  | { type: 'PAGE_AGENT_RENAME_WORKFLOW'; workflowId: string; name: string; expectedUpdatedAt: number }
  | { type: 'PAGE_AGENT_GET_INSTANCE' }
  | { type: 'PAGE_AGENT_GET_MCP_INFO' }
  | { type: 'PAGE_AGENT_SAVE_MCP_OPTIONS'; options: McpClientOptions }
  | { type: 'PAGE_AGENT_RECONNECT_MCP' }
  | { type: 'PAGE_AGENT_SET_STATE'; state: WorkspaceState; expectedRevisions?: Record<string, number> }
  | { type: 'PAGE_AGENT_GET_PROVIDER' }
  | { type: 'PAGE_AGENT_SAVE_PROVIDER'; config: AiProviderConfig; apiKey?: string }
  | { type: 'PAGE_AGENT_TEST_PROVIDER'; config: AiProviderConfig; apiKey?: string }
  | { type: 'PAGE_AGENT_STATE_CHANGED' }
  | { type: 'PAGE_AGENT_BRIDGE_STATUS'; connected: boolean; connecting?: boolean; error?: string };

export interface RuntimeResponse {
  ok: boolean;
  error?: string;
  result?: RunResult | RecordingResult | unknown;
  state?: WorkspaceState;
}
