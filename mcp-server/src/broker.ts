import { ExtensionBridge } from './bridge.js';
const bridge = new ExtensionBridge(Number(process.env.PAGE_AGENT_BRIDGE_PORT || 17373));
try { await bridge.ready; }
catch (error) {
  // Two MCP tools can launch simultaneously; only one broker owns the port.
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exit(0);
  process.stderr.write(`[page-agent] Broker failed: ${(error as Error).message}\n`);
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void bridge.close().then(() => process.exit(0)); });
