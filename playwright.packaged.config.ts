import { defineConfig } from '@playwright/test';

// The built package in dist/ (run `pnpm run pack` first). Separate from `pnpm e2e`, which tests the build in out/.
export default defineConfig({
  testDir: './tests/e2e/packaged',
  testMatch: '**/*.packaged.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/e2e-packaged',
});
