import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3029',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
  },
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3029/api/auth/me',
    reuseExistingServer: false,
    env: {
      PORT: '3029',
      MEOW_AUTH_BASE_URL: 'http://localhost:3029',
      MEOW_AUTH_MODE: 'session',
      MEOW_DATABASE: ':memory:',
      MEOW_AUTH_SECRET: 'test-only-secret-not-for-production-0123456789',
    },
  },
});
