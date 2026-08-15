import type { EventDefinition, PageTarget, RunResult, WorkspaceState } from './workflow';

export type RuntimeMessage =
  | { type: 'PAGE_AGENT_PING' }
  | { type: 'PAGE_AGENT_START_SELECT' }
  | { type: 'PAGE_AGENT_STOP_SELECT' }
  | { type: 'PAGE_AGENT_SELECTED'; target: Omit<PageTarget, 'frameId'> }
  | { type: 'PAGE_AGENT_SELECTION'; target: PageTarget }
  | { type: 'PAGE_AGENT_EXECUTE_EVENT'; selector: string; event: EventDefinition }
  | { type: 'PAGE_AGENT_EXECUTE_AI'; instruction: string; event: EventDefinition; scopeSelector?: string }
  | { type: 'PAGE_AGENT_RUN_NODES'; nodes: unknown[] }
  | { type: 'PAGE_AGENT_RUN_SCRIPT'; scriptId: string; variables?: Record<string, string> }
  | { type: 'PAGE_AGENT_RUN_ACTION'; actionId: string; variables?: Record<string, string> }
  | { type: 'PAGE_AGENT_GET_STATE' }
  | { type: 'PAGE_AGENT_SET_STATE'; state: WorkspaceState }
  | { type: 'PAGE_AGENT_STATE_CHANGED' }
  | { type: 'PAGE_AGENT_BRIDGE_STATUS'; connected: boolean };

export interface RuntimeResponse {
  ok: boolean;
  error?: string;
  result?: RunResult | unknown;
  state?: WorkspaceState;
}
