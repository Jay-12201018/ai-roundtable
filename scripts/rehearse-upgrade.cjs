#!/usr/bin/env node
// Rehearses an upgrade on a COPY of a database: copies it to a temporary folder, runs the app's current migrations and
// its startup recovery on that copy, and reports what changed. The input file is only ever read as bytes: it is never
// opened as a database, because SQLite would create -wal and -shm files beside it. Row contents are never printed.
//
// Making a safe copy (the app may keep recent writes in a -wal file, so copying the .db alone can lose them):
//   1. Quit AI Roundtable.
//   2. sqlite3 "<the database>" ".backup '/somewhere/else/copy.db'"
//      (macOS has sqlite3 built in. .backup includes the WAL's contents and gives one self-contained file.)
//   3. pnpm rehearse:upgrade /somewhere/else/copy.db
//
// Options: --json prints the report as JSON; --keep keeps the temporary folder and names it.
// Exit codes: 0 passed; 1 the rehearsal failed; 2 refused or wrong usage, nothing was copied.
// A path inside the app's real or trial data folder is refused, also through a link, as is a file with an unmerged
// -wal or -journal beside it (see above) or a second hard link.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const { tmpdir } = require('node:os');
const { dirname, join, resolve, sep } = require('node:path');
const { appDataDirectory } = require('./trial/profile.cjs');

const root = resolve(__dirname, '..');
const refuse = message => { console.error(`已拒绝：${message}`); process.exit(2); };

function protectedFolders() {
  const appData = appDataDirectory();
  const names = ['ai-roundtable', 'ai-roundtable-trial'].map(name => join(appData, name));
  return names.flatMap(path => { try { return [path, fs.realpathSync(path)]; } catch { return [path]; } });
}

// Decided from the path text first, so a path inside those folders is refused without being touched.
function checkInput(given) {
  const inside = path => protectedFolders().some(folder => { const a = path.toLowerCase(), b = folder.toLowerCase(); return a === b || a.startsWith(b + sep); });
  const input = resolve(given);
  if (inside(input)) refuse('这是应用的数据目录。请先生成副本，用法见脚本开头的说明。');
  const info = fs.statSync(input, { throwIfNoEntry: false });
  if (!info) refuse('文件不存在。');
  if (!info.isFile()) refuse('输入必须是一个文件。');
  if (inside(fs.realpathSync(input))) refuse('这个路径是指向应用数据目录的链接。请先生成副本。');
  if (info.nlink > 1) refuse('这个文件有多个硬链接，可能就是原始数据库。请用 .backup 生成独立副本。');
  for (const suffix of ['-wal', '-journal']) {
    if ((fs.statSync(input + suffix, { throwIfNoEntry: false })?.size ?? 0) > 0) refuse(`旁边有未合并的 ${suffix} 文件，只复制 .db 可能丢数据。请用 .backup 生成单文件副本。`);
  }
  return input;
}

/** The app's current Database class, compiled from source in memory. Nothing is written into the repository. */
function loadDatabaseClass() {
  const esbuild = Module.createRequire(require.resolve('vite'))('esbuild');
  const [output] = esbuild.buildSync({ entryPoints: [join(root, 'src/main/database/Database.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' }).outputFiles;
  const filename = join(root, 'scripts/.rehearse-database.cjs');
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(output.text, filename);
  return compiled.exports.Database;
}

const sha256File = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const quoted = name => `"${name.replaceAll('"', '""')}"`;
// Contents that no migration or recovery step may change, compared by hash where the table and columns exist.
// D133: migration 14 drops these on purpose; their token usage moves to request_usage and the rest stays in the verified backup.
const retired = new Set(['controlled_trials', 'controlled_trial_reconciliations', 'run_budgets', 'run_budget_topups', 'request_charges', 'summary_charges', 'artifact_charges', 'charge_pricing', 'charge_writeoffs']);
const unchanged = { rooms: ['id', 'name'], messages: ['id', 'sender_name', 'content'], key_records: ['id', 'provider_id', 'encrypted_value'] };

function inspect(Driver, path) {
  const db = new Driver(path, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
    const version = tables.includes('schema_migrations') ? db.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get() ?? 0 : 0;
    const rows = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT COUNT(*) FROM ${quoted(table)}`).pluck().get()]));
    const hashes = {};
    for (const [table, columns] of Object.entries(unchanged)) {
      if (!tables.includes(table)) continue;
      const hash = createHash('sha256');
      for (const row of db.prepare(`SELECT ${columns.map(quoted).join(',')} FROM ${quoted(table)} ORDER BY id`).iterate()) hash.update(JSON.stringify(row));
      hashes[table] = hash.digest('hex');
    }
    const statuses = tables.includes('workflow_runs') ? Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM workflow_runs GROUP BY status').all().map(row => [row.status, row.n])) : {};
    return { version, rows, hashes, statuses };
  } finally { db.close(); }
}

async function rehearse(Driver, Database, copy) {
  const before = inspect(Driver, copy);
  // In the order the app starts: migrate (with its verified backup), clean, recover.
  const db = new Database(copy);
  let purged, interrupted, restoreChecked = false;
  try {
    await db.initialize();
    purged = db.purgeKeyLikeModelIds();
    interrupted = db.markInFlightRunsInterrupted();
  } finally { db.close(); }
  // A second start validates the upgraded file again, and the backup the upgrade made must restore.
  const reopened = new Database(copy);
  try {
    await reopened.initialize();
    const receipt = new Driver(copy, { readonly: true });
    const backups = receipt.prepare('SELECT id FROM schema_backups WHERE verified_at IS NOT NULL ORDER BY id').pluck().all();
    receipt.close();
    if (backups.length) {
      const restored = await reopened.prepareRegisteredRestore(backups.at(-1));
      fs.rmSync(restored.directory, { recursive: true, force: true });
      restoreChecked = true;
    }
  } finally { reopened.close(); }
  const after = inspect(Driver, copy);
  const problems = [];
  for (const [table, count] of Object.entries(before.rows)) {
    if (retired.has(table)) continue;
    if (!(table in after.rows)) problems.push(`表 ${table} 不见了`);
    else if (after.rows[table] < count) problems.push(`表 ${table} 少了 ${count - after.rows[table]} 行`);
  }
  const usageBefore = ['request_charges', 'summary_charges', 'artifact_charges'].reduce((total, table) => total + (before.rows[table] ?? 0), 0);
  if (before.version < 14 && after.version >= 14 && (after.rows.request_usage ?? 0) < usageBefore) problems.push(`token 用量少了 ${usageBefore - (after.rows.request_usage ?? 0)} 行`);
  for (const [table, hash] of Object.entries(before.hashes)) if (after.hashes[table] !== hash) problems.push(`表 ${table} 的内容变了`);
  if (before.version < after.version && !restoreChecked) problems.push('升级没有留下可恢复的备份');
  const rows = Object.keys(after.rows).map(table => ({ table, before: before.rows[table] ?? null, after: after.rows[table] }));
  return { from: before.version, to: after.version, purgedKeyLikeModelIds: purged, interruptedRuns: interrupted, runStatusBefore: before.statuses, runStatusAfter: after.statuses, backupRestoreChecked: restoreChecked, rows, problems };
}

function print(report) {
  console.log(`版本：v${report.from} → v${report.to}`);
  if (report.error) { console.log(`失败：${report.error}`); }
  else {
    console.log(`启动恢复：${report.interruptedRuns} 个未完成的讨论标为中断；清除 ${report.purgedKeyLikeModelIds} 处疑似 Key 的模型 ID`);
    console.log(`升级备份可恢复：${report.backupRestoreChecked ? '是' : '没有发生升级，不需要备份'}`);
    console.log('行数（升级前 → 升级后）：');
    for (const { table, before, after } of report.rows) console.log(`  ${table}: ${before ?? '新表'} → ${after}`);
    for (const problem of report.problems) console.log(`问题：${problem}`);
  }
  console.log(`输入文件：${report.inputUnchanged ? '没有变化' : '有变化！'}`);
  console.log(`结果：${report.status === 'PASS' ? '通过' : '未通过'}`);
}

async function main() {
  const args = process.argv.slice(2);
  const paths = args.filter(arg => !arg.startsWith('--'));
  const unknown = args.filter(arg => arg.startsWith('--') && !['--json', '--keep'].includes(arg));
  if (paths.length !== 1 || unknown.length) refuse('用法：pnpm rehearse:upgrade <数据库副本路径> [--json] [--keep]');
  const input = checkInput(paths[0]);
  const inputHash = sha256File(input);

  const Driver = Module.createRequire(join(root, 'package.json'))('better-sqlite3');
  const Database = loadDatabaseClass();
  const work = fs.mkdtempSync(join(tmpdir(), 'roundtable-rehearsal-'));
  fs.chmodSync(work, 0o700);
  const copy = join(work, 'rehearsal.db');
  fs.copyFileSync(input, copy);
  fs.chmodSync(copy, 0o600);
  let report;
  try { report = await rehearse(Driver, Database, copy); }
  catch (error) { report = { from: null, to: null, problems: [], error: error instanceof Error ? error.message : String(error) }; }
  // Reported as read from disk: a change would mean this tool broke its promise.
  report.inputUnchanged = sha256File(input) === inputHash && !fs.existsSync(input + '-wal') && !fs.existsSync(input + '-shm');
  report.status = !report.error && !report.problems.length && report.inputUnchanged ? 'PASS' : 'FAIL';
  if (args.includes('--keep')) report.kept = work;
  else fs.rmSync(work, { recursive: true, force: true });
  if (args.includes('--json')) console.log(JSON.stringify(report));
  else print(report);
  if (report.kept && !args.includes('--json')) console.log(`临时目录：${report.kept}`);
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
