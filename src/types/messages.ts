import type { AiProviderConfig } from './provider';
import type { McpClientOptions } from './mcp';
import type { DomQuery, EventDefinition, PageTarget, RecordedPageEvent, RecordedTargetHint, RecordingResult, RunResult, StepResult, WorkflowEdge, WorkspaceState } from './workflow';

export type RuntimeMessage =
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
  | { type: 'PAGE_AGENT_RUN_NODES'; nodes: unknown[] }
  | { type: 'PAGE_AGENT_RUN_GRAPH'; nodes: unknown[]; edges: WorkflowEdge[]; variables?: Record<string, unknown>; runId?: string }
  | { type: 'PAGE_AGENT_RUN_PROGRESS'; runId: string; nodeId: string; phase: 'running' | 'completed'; steps?: StepResult[] }
  | { type: 'PAGE_AGENT_RUN_SCRIPT'; scriptId: string; variables?: Record<string, unknown> }
  | { type: 'PAGE_AGENT_RUN_ACTION'; actionId: string; variables?: Record<string, unknown> }
  | { type: 'PAGE_AGENT_GET_STATE' }
  | { type: 'PAGE_AGENT_GET_INSTANCE' }
  | { type: 'PAGE_AGENT_GET_MCP_INFO' }
  | { type: 'PAGE_AGENT_SAVE_MCP_OPTIONS'; options: McpClientOptions }
  | { type: 'PAGE_AGENT_RECONNECT_MCP' }
  | { type: 'PAGE_AGENT_SET_STATE'; state: WorkspaceState }
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
