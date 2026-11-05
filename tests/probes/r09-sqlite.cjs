// Read-only audit, after the production Main has naturally closed its private SQLite database.
const assert=require('node:assert/strict');const fs=require('node:fs');const {join,dirname,basename,resolve}=require('node:path');const {tmpdir}=require('node:os');const Sqlite=require('better-sqlite3');const {quotedPosition,before,foreignAsAssistant,membersByMessage}=require('./public-context.cjs');
assert.ok(process.versions.electron);assert.equal(process.versions.modules,'139');assert.equal(process.argv.length,3);
const resultPath=fs.realpathSync(process.argv[2]);const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));assert.equal(result.status,'PASS');
const directory=fs.realpathSync(result.directory);assert.equal(dirname(directory),fs.realpathSync(tmpdir()));assert.ok(basename(directory).startsWith('roundtable-r09-production-'));assert.equal(dirname(resultPath),directory);
assert.deepEqual(JSON.parse(fs.readFileSync(join(directory,'r09-owner.json'),'utf8')),{probe:'R09 production smoke',uid:process.getuid(),directory:result.directory});
assert.equal(resolve(result.paths.userData),join(result.directory,'userData'));
const db=new Sqlite(join(directory,'userData','ai-roundtable.db'),{readonly:true,fileMustExist:true});
let checks=0;const check=(v,message)=>{checks++;assert.ok(v,message);};
try{
 assert.deepEqual(db.prepare('PRAGMA integrity_check').pluck().all(),['ok']);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all(),[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
 const saved=result.saved;const run=db.prepare('SELECT status,members_snapshot FROM workflow_runs WHERE id=?').get(saved.runId);assert.equal(run.status,'completed');const members=JSON.parse(run.members_snapshot);assert.deepEqual(members.map(m=>m.providerId),[saved['compatible'],saved.second,saved['compatible']]);
 const messages=id=>db.prepare('SELECT id,content,status FROM messages WHERE run_id=? ORDER BY rowid').all(id);
 const attempts=id=>db.prepare('SELECT request_id,input_snapshot,status FROM request_attempts WHERE run_id=? ORDER BY rowid').all(id);
 const completed=messages(saved.runId);const rows=attempts(saved.runId);assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.request_id)).size,3);assert.ok(rows.every(r=>r.status==='completed'));
 if(result.phase==='first'){
  const authors=membersByMessage(db,saved.runId);const calls=result.requests.filter(r=>r.method==='POST'&&r.body.messages.some(m=>m.content.includes('R09 three Agent public context')));assert.equal(calls.length,3);
  for(let i=0;i<3;i++){
   const input=JSON.parse(rows[i].input_snapshot);assert.deepEqual(calls[i].body.messages,input.messages);assert.equal(input.modelId,'fixture');assert.equal(input.outputTokenLimit,8192);
   check(input.messages.some(m=>m.role==='system'&&m.content.includes('R09 system '+i)),'Frozen member system missing');
   // D095: earlier members' replies are labelled "> " quotes on the user side, in order, never assistant turns.
   const positions=completed.slice(0,i).map(m=>quotedPosition(input.messages,authors[m.id],m.content));
   for(let j=0;j<i;j++)check(positions[j]&&(j===0||before(positions[j-1],positions[j]))&&!foreignAsAssistant(input.messages,completed[j].content),'Ordered public context missing');
  }
  assert.equal(db.prepare("SELECT count(*) FROM run_events WHERE run_id=? AND type='usage_updated'").pluck().get(saved.runId),3);
 }
 const repeats=attempts(saved.stopRunId);const partial=messages(saved.stopRunId);assert.equal(repeats.length,3);assert.ok(repeats.every(a=>a.status==='aborted'));assert.ok(partial.every(m=>m.content.length>0&&m.status==='aborted'));
 const original=JSON.parse(repeats[0].input_snapshot).messages;assert.deepEqual(JSON.parse(repeats[1].input_snapshot).messages,original);assert.deepEqual(JSON.parse(repeats[2].input_snapshot).messages,[...original,{role:'assistant',content:partial[1].content},{role:'user',content:'Continue the previous response from where it stopped.'}]);
 const records=db.prepare('SELECT provider_id,encrypted_value,backend FROM key_records').all();assert.equal(records.length,2);assert.ok(records.every(k=>k.backend==='r09-fixture-only'));
 for(const table of ['rooms','agents','providers','workflow_runs','turns','messages','request_attempts','run_events','key_records'])check(!JSON.stringify(db.prepare('SELECT * FROM '+table).all()).includes('r09-fake-key-'),'Plain Key persisted in '+table);
 assert.equal(db.prepare("SELECT COUNT(*) FROM workflow_runs WHERE status IN ('running','pausing','paused','cancelling')").pluck().get(),0);
 console.log(JSON.stringify({status:'PASS',phase:result.phase,checks,completedAttempts:3,explicitRepeatAttempts:3,actualElectronAbi:process.versions.modules,readOnlyAudit:true}));
}finally{db.close();}
