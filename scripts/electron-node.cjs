#!/usr/bin/env node
// Run a Node script inside Electron's embedded Node (ELECTRON_RUN_AS_NODE).
// Tests and tooling share the single Electron-ABI build of better-sqlite3, so
// the native module never has to be rebuilt for the host Node.
const { spawnSync } = require('node:child_process');
const electron = require('electron');

const result = spawnSync(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
