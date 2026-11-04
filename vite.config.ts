import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // The build process knows the local project and Node locations; Chrome cannot
  // recover filesystem paths from an extension URL at runtime.
  define: {
    __PAGE_AGENT_LOCAL_MCP__: JSON.stringify({
      command: process.env.PAGE_AGENT_PORTABLE === '1' ? 'node' : process.execPath,
      serverPath: process.env.PAGE_AGENT_PORTABLE === '1' ? '' : fileURLToPath(new URL('./mcp-server/dist/index.js', import.meta.url)),
    }),
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', sourcemap: true, rollupOptions: { input: {
    recorder: fileURLToPath(new URL('./src/offscreen/recorder.html', import.meta.url)),
    recorderPrototype: fileURLToPath(new URL('./src/recorder-prototype/index.html', import.meta.url)),
  } } },
  server: { port: 5173, strictPort: true, hmr: { port: 5174 } },
});
