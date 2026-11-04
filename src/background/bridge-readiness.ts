import { MCP_BRIDGE_PORT } from '@/types/mcp';

/**
 * The existing broker's HTTP listener answers 426 (Upgrade Required).
 * Check it before constructing a WebSocket: Chrome records refused WebSocket
 * handshakes as extension errors even when an error listener handles them.
 * A stopped service is an ordinary offline state, not an uncaught exception.
 */
export async function isBridgeListening(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${MCP_BRIDGE_PORT}/extension`, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    return response.status === 426;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
