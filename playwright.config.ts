import { defineConfig } from '@playwright/test';

// Real Electron only (`_electron` in tests/e2e/support/app.ts), one app at a time: each case owns a temporary profile.
// An empty or fully filtered test set fails (Playwright's default without --pass-with-no-tests).
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/e2e',
});
