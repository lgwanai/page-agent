import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.e2e.ts', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 7000 }, reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'node e2e/fixtures/server.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
});
