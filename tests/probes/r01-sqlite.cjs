// Read only the fresh profile recorded by the finite R01 probe, after Electron exits.
const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const Database = require('better-sqlite3');

assert.ok(process.versions.electron, 'Run with ELECTRON_RUN_AS_NODE=1 and the installed Electron');
assert.equal(process.argv.length, 3, 'Pass one probe-result.json path');
const metadataPath = realpathSync(process.argv[2]);
const result = JSON.parse(readFileSync(metadataPath, 'utf8'));
const temporary = realpathSync(result.temporaryDirectory);
assert.equal(dirname(temporary), realpathSync(tmpdir()));
assert.ok(basename(temporary).startsWith('roundtable-r01-electron-'));
assert.equal(metadataPath, join(temporary, 'probe-result.json'));
assert.equal(realpathSync(result.userData), join(temporary, 'userData'));
assert.equal(result.status, 'PASS');
assert.equal(result.isolationBeforeReady, true);
assert.equal(result.snapshot.status, 'paused');

const database = new Database(join(temporary, 'userData', 'ai-roundtable.db'), { readonly: true, fileMustExist: true });
try {
  const run = database.prepare('SELECT status, finished_at FROM workflow_runs WHERE id = ?').get(result.runId);
  assert.equal(run.status, 'cancelled');
  assert.ok(run.finished_at);
  const messages = database.prepare('SELECT id, sender_name AS senderName, content, status FROM messages WHERE run_id = ? ORDER BY rowid').all(result.runId);
  assert.deepEqual(messages, result.snapshot.messages);
  const turns = database.prepare('SELECT id AS turnId, request_id AS requestId, partial_content AS outputText, status FROM turns WHERE run_id = ? ORDER BY turn_index').all(result.runId);
  assert.deepEqual(turns, result.snapshot.turns.map(({ turnId, requestId, outputText, status }) => ({ turnId, requestId, outputText, status })));
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM key_records').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM providers').get().count, 0);
  const event = database.prepare('SELECT payload_json FROM run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1').get(result.runId);
  assert.equal(JSON.parse(event.payload_json).status, 'cancelled');
  console.log('R01 shutdown SQLite PASS: cancelled, messages/turns/requests preserved, keys/providers empty');
} finally {
  database.close();
}
