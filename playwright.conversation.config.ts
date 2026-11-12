import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './conversation-e2e',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:3030',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/conversation-fixture.ts',
    url: 'http://localhost:3030/api/auth/me',
    reuseExistingServer: false,
  },
});
