// @vitest-environment node
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { describe,expect,it,vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';

function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'roundtable-r03-integrated-'));
  const path=join(directory,'source.db');const db=new Database(path);db.initialize();
  db.insertRoom({id:'room',name:'R03',objective:''});
  db.insertAgent({id:'agent',roomId:'room',displayName:'A',roleTemplateId:'draft',displayOrder:0});
  db.insertRun({id:'run',roomId:'room',status:'running',workflowSnapshot:{}});
  return {db,path,directory,dispose(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function attempt(f:ReturnType<typeof fixture>,index:number) {
  if(index===0) f.db.insertTurn({id:'turn',runId:'run',agentId:'agent',status:'running',requestId:'request-0',turnIndex:0});
  f.db.insertMessage({id:`message-${index}`,roomId:'room',runId:'run',turnId:'turn',senderType:'agent',senderName:'A',content:`partial-${index}`,status:'streaming'});
  const value=f.db.createAttempt({requestId:`request-${index}`,runId:'run',turnId:'turn',messageId:`message-${index}`,attemptIndex:index,status:'running',inputSnapshot:{requestId:`request-${index}`,modelId:'mock',messages:[{role:'user',content:`private-input-${index}`}]}});
  f.db.appendRunEvent({runId:'run',turnId:'turn',requestId:value.requestId,protocolVersion:1,type:'turn_started',payload:{turnId:'turn',messageId:value.messageId,agentId:'agent',requestId:value.requestId}});
  return value;
}

describe('R03 Attempt and cursor consistency',()=>{
  it('serializes a competing WAL writer before allocating an event sequence',()=>{
    const f=fixture();const writer=new Sqlite(f.path,{timeout:0});const second=new Database(f.path);second.initialize();
    const original=f.db.getRunEventSequence.bind(f.db);let contended=false;
    const spy=vi.spyOn(f.db,'getRunEventSequence').mockImplementation(runId=>{
      contended=true;
      expect(()=>writer.prepare("INSERT INTO run_events(run_id,sequence,type,payload_json,timestamp) VALUES('run',1,'run_state_changed','{\"status\":\"running\"}',?)").run(new Date().toISOString())).toThrow(/locked/);
      return original(runId);
    });
    try {
      expect(f.db.appendRunEvent({runId:'run',protocolVersion:1,type:'run_state_changed',payload:{status:'running'}}).sequence).toBe(1);
      spy.mockRestore();expect(contended).toBe(true);
      expect(second.appendRunEvent({runId:'run',protocolVersion:1,type:'run_state_changed',payload:{status:'paused'}}).sequence).toBe(2);
      expect(f.db.listRunEvents('run',0).map(e=>e.sequence)).toEqual([1,2]);
    } finally {spy.mockRestore();second.close();writer.close();f.dispose();}
  });
  it.each(['version','sender'] as const)('rejects malformed persisted %s without consuming a sequence',kind=>{
    const f=fixture();try {
      attempt(f,0);
      expect(()=>kind==='version'
        ? f.db.appendRunEvent({runId:'run',protocolVersion:-1,type:'run_state_changed',payload:{status:'running'}})
        : f.db.appendRunEvent({runId:'run',protocolVersion:1,turnId:'turn',requestId:'request-0',type:'text_delta',payload:{turnId:'turn',messageId:'message-0',senderName:'wrong sender',text:'wrongly attributed'}})).toThrow();
      expect(f.db.getRunEventSequence('run')).toBe(1);
    } finally {f.dispose();}
  });

  it('resynchronizes unknown persistent protocols without exposing or rewriting raw payloads',()=>{
    const f=fixture();try {
      f.db.appendRunEvent({runId:'run',protocolVersion:2,type:'future_event',payload:{private:'do not expose this payload'}});
      const sub=new RunService(f.db,new MockProvider()).subscribe('run',0);
      expect(sub.resyncRequired).toBe(true);expect(sub.events).toEqual([]);expect(sub.nextCursor).toBe(1);
      expect(JSON.stringify(sub)).not.toContain('do not expose');
      expect(f.db.listRunEvents('run',0)[0]).toMatchObject({protocolVersion:2,payload:{private:'do not expose this payload'}});
    } finally {f.dispose();}
  });
  it('reads every message page from one WAL snapshot',()=>{
    const f=fixture();const writer=new Sqlite(f.path);let written=false;
    for(const id of ['a','b'])f.db.insertMessage({id,roomId:'room',runId:'run',senderType:'agent',senderName:'A',content:id});
    const original=f.db.getMessage.bind(f.db);
    const spy=vi.spyOn(f.db,'getMessage').mockImplementation(id=>{
      if(!written){written=true;writer.prepare("UPDATE messages SET content='new-b' WHERE id='b'").run();}
      return original(id);
    });
    try {expect(f.db.listRunMessages('run',{limit:2}).messages.map(m=>m.content)).toEqual(['a','b']);}
    finally {spy.mockRestore();writer.close();f.dispose();}
  });
  it('requires the first Attempt to retain its Turn request identity',()=>{
    const f=fixture();try {
      f.db.insertTurn({id:'turn',runId:'run',agentId:'agent',status:'running',requestId:'original',turnIndex:0});
      f.db.insertMessage({id:'m',runId:'run',roomId:'room',turnId:'turn',senderType:'agent',senderName:'A',content:''});
      expect(()=>f.db.createAttempt({requestId:'different',runId:'run',turnId:'turn',messageId:'m',attemptIndex:0,status:'pending',inputSnapshot:{requestId:'different',modelId:'mock',messages:[]}})).toThrow(/identity/i);
      expect(f.db.listAttempts('run')).toEqual([]);
    } finally {f.dispose();}
  });
  it('preserves both request identities across subscriptions, backup and independently restored files',async()=>{
    const f=fixture();let raw:Sqlite.Database|undefined;let restored:Sqlite.Database|undefined;
    try {
      attempt(f,0);f.db.updateAttempt('request-0',{status:'failed'});attempt(f,1);
      const service=new RunService(f.db,new MockProvider());
      const sub=service.subscribe('run',0);
      expect(sub.resyncRequired).toBe(false);
      expect(sub.events.map(e=>e.requestId)).toEqual(['request-0','request-1']);
      expect(sub.snapshot.turns[0]).toMatchObject({requestId:'request-1',messageId:'message-1'});
      expect(sub.snapshot.attempts?.map(a=>a.requestId)).toEqual(['request-0','request-1']);
      expect(JSON.stringify(sub)).not.toMatch(/inputSnapshot|private-input/);
      raw=new Sqlite(f.path);const backup=await createVerifiedBackup(raw,f.directory);
      const candidate=await prepareRestore(backup,f.directory);restored=new Sqlite(candidate.path,{readonly:true});
      expect(restored.prepare('SELECT request_id,input_snapshot FROM request_attempts ORDER BY attempt_index').all()).toEqual([
        {request_id:'request-0',input_snapshot:JSON.stringify({requestId:'request-0',modelId:'mock',messages:[{role:'user',content:'private-input-0'}]})},
        {request_id:'request-1',input_snapshot:JSON.stringify({requestId:'request-1',modelId:'mock',messages:[{role:'user',content:'private-input-1'}]})},
      ]);
    } finally {restored?.close();raw?.close();f.dispose();}
  });

  it('rejects mismatched requests, duplicate attempts and changes to immutable input',()=>{
    const f=fixture();try {
      const first=attempt(f,0);
      expect(()=>f.db.createAttempt({...first,inputSnapshot:{requestId:'wrong',modelId:'mock',messages:[]}} as never)).toThrow();
      expect(()=>f.db.createAttempt({requestId:'request-2',runId:'run',turnId:'turn',messageId:'message-0',attemptIndex:1,status:'pending',inputSnapshot:{requestId:'request-2',modelId:'mock',messages:[]}})).toThrow();
      expect(()=>f.db.updateAttempt('request-0',{inputSnapshot:null} as never)).toThrow();
      f.db.updateAttempt('request-0',{status:'completed'});
      expect(()=>f.db.updateAttempt('request-0',{status:'running'})).toThrow();
      expect(f.db.getAttempt('request-0')?.inputSnapshot).toEqual(first.inputSnapshot);
      expect(()=>f.db.appendRunEvent({runId:'run',turnId:'turn',requestId:'request-0',protocolVersion:1,type:'turn_completed',payload:{turnId:'turn',messageId:'missing'}})).toThrow();
      expect(f.db.getRunEventSequence('run')).toBe(1);
    } finally {f.dispose();}
  });

  it('holds one read snapshot when another WAL connection commits during the read',()=>{
    const f=fixture();const writer=new Sqlite(f.path);let written=false;
    const original=f.db.getRun.bind(f.db);
    const spy=vi.spyOn(f.db,'getRun').mockImplementation(id=>{
      const value=original(id);
      if(!written){written=true;writer.prepare("INSERT INTO run_events(run_id,sequence,type,payload_json,timestamp) VALUES('run',1,'run_state_changed','{\"status\":\"running\"}',?)").run(new Date().toISOString());}
      return value;
    });
    try {
      const first=f.db.readRunSubscription('run',0);
      expect(first.sequence).toBe(0);expect(first.events).toEqual([]);expect(first.resyncRequired).toBe(false);
      spy.mockRestore();
      expect(f.db.readRunSubscription('run',0).events.map(e=>e.sequence)).toEqual([1]);
    } finally {spy.mockRestore();writer.close();f.dispose();}
  });

  it('keeps a fixed event upper bound, and uses snapshot resync rather than dropping excess events',()=>{
    const f=fixture();try {
      for(let i=0;i<5;i++)f.db.appendRunEvent({runId:'run',protocolVersion:1,type:'run_state_changed',payload:{status:'running'}});
      const first=f.db.listRunEvents('run',{cursor:0,throughSequence:4,limit:2});
      expect(first.events.map(e=>e.sequence)).toEqual([1,2]);expect(first.hasMore).toBe(true);expect(first.nextCursor).toBe(2);
      f.db.appendRunEvent({runId:'run',protocolVersion:1,type:'run_state_changed',payload:{status:'paused'}});
      const last=f.db.listRunEvents('run',{cursor:first.nextCursor,throughSequence:4,limit:2});
      expect(last.events.map(e=>e.sequence)).toEqual([3,4]);expect(last.hasMore).toBe(false);
      expect(()=>f.db.listRunEvents('run',{cursor:0,throughSequence:99,limit:1})).toThrow();
      for(let i=6;i<501;i++)f.db.appendRunEvent({runId:'run',protocolVersion:1,type:'run_state_changed',payload:{status:'running'}});
      const sub=new RunService(f.db,new MockProvider()).subscribe('run',0);
      expect(sub.nextCursor).toBe(501);expect(sub.resyncRequired).toBe(true);expect(sub.events).toEqual([]);
    } finally {f.dispose();}
  });

  it('discards rolled-back notifications and preserves idle without changing the state machine',()=>{
    const f=fixture();try {
      const events:number[]=[];
      expect(()=>f.db.transaction(()=>{const e=f.db.appendRunEvent({runId:'run',type:'run_state_changed',payload:{status:'running'}});f.db.afterCommit(()=>events.push(e.sequence));throw new Error('rollback');})).toThrow('rollback');
      expect(events).toEqual([]);expect(f.db.getRunEventSequence('run')).toBe(0);
      f.db.updateRun('run',{status:'idle'});expect(f.db.markInFlightRunsInterrupted()).toBe(0);expect(f.db.getRun('run')?.status).toBe('idle');
    } finally {f.dispose();}
  });
});
