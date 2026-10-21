#!/usr/bin/env node
// Make sure better-sqlite3 loads in Electron; rebuild for Electron only when it does not.
// Replaces the old unconditional `electron-rebuild --force` / `pnpm rebuild` flip-flop.
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const electron = require('electron');

const root = join(__dirname, '..');
const probe = `const D = require(${JSON.stringify(join(root, 'node_modules/better-sqlite3'))});
const db = new D(':memory:'); db.exec('CREATE TABLE t (v)'); db.close();`;

function loads() {
  const r = spawnSync(electron, ['-e', probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { ok: r.status === 0, detail: (r.stderr || '').split('\n').find(Boolean) ?? '' };
}

const first = loads();
if (first.ok) process.exit(0);

console.log(`better-sqlite3 does not load in Electron (${first.detail}); rebuilding for Electron...`);
const bin = join(root, 'node_modules/.bin/electron-rebuild');
const rebuild = spawnSync(bin, ['--force', '--which-module', 'better-sqlite3'], { cwd: root, stdio: 'inherit' });
if (rebuild.status !== 0) process.exit(rebuild.status ?? 1);

const second = loads();
if (!second.ok) {
  console.error(`better-sqlite3 still fails to load in Electron after rebuild: ${second.detail}`);
  process.exit(1);
}
console.log('better-sqlite3 rebuilt for Electron.');
