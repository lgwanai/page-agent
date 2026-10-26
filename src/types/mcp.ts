export const MCP_BRIDGE_PORT = 17373;
export const MCP_BRIDGE_URL = `ws://127.0.0.1:${MCP_BRIDGE_PORT}/extension`;

export interface McpClientOptions {
  command: string;
  serverPath: string;
}

export interface McpConnectionInfo {
  serverVersion?: string;
  protocolVersion?: number;
  instanceId: string;
  connected: boolean;
  connecting: boolean;
  bridgeUrl: string;
  error?: string;
  clientOptions: McpClientOptions;
  clientOptionsSource?: 'setup' | 'saved' | 'service' | 'unconfigured';
  runningClientOptions?: McpClientOptions;
  configurationMismatch?: boolean;
}
