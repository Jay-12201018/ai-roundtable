// Read-only post-exit audit of a profile created by r07r08-electron.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, dirname, basename, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const Sqlite = require('better-sqlite3');
assert.ok(process.versions.electron, 'Use Electron with ELECTRON_RUN_AS_NODE=1');
assert.equal(process.argv.length, 3, 'Pass one r78-first.json or r78-restart.json');
const resultPath = fs.realpathSync(process.argv[2]);
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const directory = fs.realpathSync(result.directory);
assert.equal(dirname(directory), fs.realpathSync(tmpdir()));
assert.ok(basename(directory).startsWith('roundtable-r78-production-'));
assert.ok(['r78-first.json', 'r78-restart.json'].includes(basename(resultPath)));
assert.equal(dirname(resultPath), directory);
const owner = JSON.parse(fs.readFileSync(join(directory, 'r78-owner.json'), 'utf8'));
assert.deepEqual(owner, { probe: 'R78 production smoke', uid: process.getuid(), directory: result.directory });
assert.equal(result.status, 'PASS'); assert.equal(result.isolationBeforeReady, true);
assert.equal(resolve(result.paths.userData), join(result.directory, 'userData'));
const databasePath = join(directory, 'userData', 'ai-roundtable.db');
const database = new Sqlite(databasePath, { readonly: true, fileMustExist: true });
try {
  assert.deepEqual(database.prepare('PRAGMA integrity_check').pluck().all(), ['ok']);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(database.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all(), [1,2,3,4]);
  const saved = result.saved;
  const completed = result.ui.snapshots.final ?? result.ui.snapshots.restarted;
  assert.equal(database.prepare('SELECT status FROM workflow_runs WHERE id=?').pluck().get(saved.runId), 'completed');
  const messages = id => database.prepare('SELECT id,sender_name AS senderName,content,status FROM messages WHERE run_id=? ORDER BY rowid').all(id);
  assert.deepEqual(messages(saved.runId), completed.messages);
  const attempts = id => database.prepare('SELECT request_id,message_id,input_snapshot,status FROM request_attempts WHERE run_id=? ORDER BY rowid').all(id);
  const mainAttempts = attempts(saved.runId); assert.equal(mainAttempts.length, 3);
  const second = JSON.parse(mainAttempts[1].input_snapshot).messages;
  const third = JSON.parse(mainAttempts[2].input_snapshot).messages;
  assert.ok(second.some(message => message.role === 'assistant' && message.content.includes(completed.messages[0].content)), 'Second Agent lacks first public output');
  const firstIndex = third.findIndex(message => message.role === 'assistant' && message.content.includes(completed.messages[0].content));
  const secondIndex = third.findIndex(message => message.role === 'assistant' && message.content.includes(completed.messages[1].content));
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex, 'Third Agent lacks ordered public context');
  const repeats = attempts(saved.repeatRunId); assert.equal(repeats.length, 3);
  const original = JSON.parse(repeats[0].input_snapshot).messages;
  assert.deepEqual(JSON.parse(repeats[1].input_snapshot).messages, original);
  const repeatMessages = messages(saved.repeatRunId);
  assert.deepEqual(JSON.parse(repeats[2].input_snapshot).messages, [...original, { role:'assistant', content:repeatMessages[1].content }, { role:'user', content:'Continue the previous response from where it stopped.' }]);
  assert.deepEqual(repeats.map(attempt => attempt.status), ['aborted','aborted','aborted']);
  assert.equal(database.prepare('SELECT COUNT(*) FROM rooms WHERE id=?').pluck().get(saved.otherRoomId), 0);
  assert.equal(database.prepare('SELECT COUNT(*) FROM agents WHERE room_id=?').pluck().get(saved.roomId), 3);
  const key = database.prepare('SELECT id,provider_id,encrypted_value,backend FROM key_records').all();
  assert.equal(key.length, 1); assert.equal(key[0].provider_id, saved.realProviderId); assert.equal(key[0].id, saved.keyReference.id);
  assert.equal(key[0].backend, 'r78-fixture-only');
  const decoded = Buffer.from([...Buffer.from(key[0].encrypted_value, 'base64')].map(value => value ^ 0xa5)).toString();
  assert.equal(decoded, 'r78-fake-key-final');
  assert.equal(database.prepare('SELECT api_key_reference FROM providers WHERE id=?').pluck().get(saved.otherProviderId), null);
  for (const table of ['rooms','agents','providers','workflow_runs','turns','messages','request_attempts','run_events','key_records']) {
    assert.ok(!/r78-fake-key-(?:one|two|three|final)/u.test(JSON.stringify(database.prepare('SELECT * FROM ' + table).all())), 'Plain fake Key persisted in ' + table);
  }
  console.log(JSON.stringify({ status:'PASS', phase:result.phase, sqlite:process.versions.modules, privateProfile:directory, completedRun:saved.runId, attempts:3, repeatAttempts:3, keyRecords:1, fakeBackendOnly:true, publicContext:true, historicalDataPreserved:true }));
} finally { database.close(); }
