import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, root, test } from './support/app';

const electronBinary = createRequire(import.meta.url)('electron') as unknown as string;

test('the app reports only the test profile, keeps its database there and uses the fake Key backend', async ({ harness }) => {
  const running = await harness.launch();
  const state = await running.state();
  expect(state.profile).toBe(harness.profile);
  // No test reaches the real folders; this only shows they are not what Main was given.
  const userData = await running.app.evaluate(({ app }) => app.getPath('userData'));
  for (const real of ['ai-roundtable', 'ai-roundtable-trial']) expect(userData).not.toBe(join(homedir(), 'Library/Application Support', real));
  const [[version]] = harness.sql('SELECT MAX(version) AS version FROM schema_migrations');
  expect(version.version).toBeGreaterThanOrEqual(13);
  expect(await running.app.evaluate(({ safeStorage }) => safeStorage.getSelectedStorageBackend?.())).toBe('e2e-fixture-only');
  await running.expectNoNetwork();
  await running.quit();
});

// A failing launch must stop before Main is imported: no window, no database, a dedicated exit code.
for (const [name, profile] of [
  ['no profile', undefined],
  ['the real data folder', join(homedir(), 'Library/Application Support/ai-roundtable')],
  ['the trial data folder', join(homedir(), 'Library/Application Support/ai-roundtable-trial')],
  ['a look-alike outside the temp directory', join(homedir(), 'roundtable-e2e-fake')],
] as const) {
  test(`the entry refuses to start with ${name}`, () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ROUNDTABLE_E2E_PROFILE: profile };
    const result = spawnSync(electronBinary, [join(root, 'tests/e2e/support/entry.cjs')], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('E2E_ISOLATION_REFUSED');
  });
}
