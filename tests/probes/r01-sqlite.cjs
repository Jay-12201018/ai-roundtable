// Read only the fresh profile recorded by the finite R01 probe, after Electron exits.
const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { quotedPosition, before, foreignAsAssistant, membersByMessage } = require('./public-context.cjs');

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
  if(result.jointMode) {
    const joint=result.jointRuns;
    const attempts=id=>database.prepare('SELECT request_id,message_id,input_snapshot,status FROM request_attempts WHERE run_id=? ORDER BY attempt_index,rowid').all(id);
    const complete=attempts(joint.completed.runId);
    assert.equal(complete.length,3);
    const b=JSON.parse(complete[1].input_snapshot).messages;
    const c=JSON.parse(complete[2].input_snapshot).messages;
    // D095: earlier members' replies are labelled "> " quotes on the user side, in order, never assistant turns.
    const authors=membersByMessage(database,joint.completed.runId);
    const [one,two]=joint.completed.messages;
    assert.ok(quotedPosition(b,authors[one.id],one.content) && !foreignAsAssistant(b,one.content));
    const first=quotedPosition(c,authors[one.id],one.content);
    const second=quotedPosition(c,authors[two.id],two.content);
    assert.ok(first && second && before(first,second));
    assert.ok(!foreignAsAssistant(c,one.content) && !foreignAsAssistant(c,two.content));
    const repeated=attempts(joint.stopped.runId);
    assert.equal(repeated.length,3);
    const original=JSON.parse(repeated[0].input_snapshot).messages;
    assert.deepEqual(JSON.parse(repeated[1].input_snapshot).messages,original);
    assert.deepEqual(JSON.parse(repeated[2].input_snapshot).messages,[...original,{role:'assistant',content:joint.repeats[0].messages[1].content},{role:'user',content:'Continue the previous response from where it stopped.'}]);
    assert.deepEqual(repeated.map(a=>a.status),['aborted','aborted','aborted']);
    for(const snapshot of [joint.completed,joint.repeats[1]]){
      assert.equal(database.prepare('SELECT status FROM workflow_runs WHERE id=?').pluck().get(snapshot.runId),snapshot.status);
      const messages=database.prepare('SELECT id,sender_name AS senderName,content,status FROM messages WHERE run_id=? ORDER BY rowid').all(snapshot.runId);
      assert.deepEqual(messages,snapshot.messages);
    }
    console.log('Joint desktop UI/refresh/Pause/Step/Resume/Stop/Retry/Continue and durable inputs PASS; actual Provider-input capture is independently asserted in joint Vitest tests');
  }
  if(result.recoveryMode) {
    assert.equal(result.recoveryChecks.length,9);
    for(const status of ['running','pausing','paused','cancelling','idle','completed','cancelled','error','interrupted']) {
      const id='r03-'+status;const recovered=['running','pausing','paused','cancelling'].includes(status);
      assert.equal(database.prepare('SELECT status FROM workflow_runs WHERE id=?').pluck().get(id),recovered?'interrupted':status);
      assert.equal(database.prepare('SELECT status FROM turns WHERE run_id=?').pluck().get(id),recovered?'interrupted':'running');
      assert.equal(database.prepare('SELECT COUNT(*) FROM run_events WHERE run_id=?').pluck().get(id),recovered?1:0);
      assert.equal(database.prepare('SELECT input_snapshot FROM request_attempts WHERE run_id=?').pluck().get(id),null);
    }
    const receipt=database.prepare('SELECT * FROM schema_backups').all();assert.equal(receipt.length,1);
    assert.equal(dirname(realpathSync(receipt[0].path)),join(temporary,'userData','backups'));
    assert.equal(createHash('sha256').update(readFileSync(receipt[0].path)).digest('hex'),receipt[0].sha256);
    const backup=new Database(receipt[0].path,{readonly:true,fileMustExist:true});
    try {
      assert.deepEqual(backup.prepare('SELECT version FROM schema_migrations').pluck().all(),[1]);
      assert.equal(backup.prepare('SELECT COUNT(*) FROM workflow_runs').pluck().get(),9);
      assert.equal(backup.prepare("SELECT status FROM workflow_runs WHERE id='r03-paused'").pluck().get(),'paused');
      assert.equal(backup.prepare("SELECT content FROM messages WHERE run_id='r03-paused'").pluck().get(),'R03 preexisting partial');
    } finally {backup.close();}
    console.log('R03 startup recovery/verified v1 backup/legacy unknown inputs PASS: 9 Runs, 4 interrupted, terminal/idle evidence preserved');
  }
} finally {
  database.close();
}
