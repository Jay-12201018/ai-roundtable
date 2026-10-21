// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,readdirSync,rmSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath,URL } from 'node:url';
import Sqlite from 'better-sqlite3';
import { describe,expect,it } from 'vitest';
import { Database } from '../../../src/main/database/Database';

const baseline=execFileSync('git',['show','135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'});
const sql=baseline.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'roundtable-r03-v1-'));const path=join(directory,'source.db');
  const db=new Sqlite(path);db.exec(sql);
  const time='2026-10-13T00:00:00.000Z';
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
  db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time);
  db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('room','Legacy','objective is not task',time,time);
  db.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('agent','room','A','draft',time,time);
  db.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('run','room','paused','{}',time,time);
  db.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('turn','run','agent','running','request',0,'original partial',time,time);
  db.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('message','room','run','turn','agent','A','original partial','streaming',time,time);
  db.close();return {directory,path,dispose(){rmSync(directory,{recursive:true,force:true});}};
}

describe('R03 migration 2 integration',()=>{
  it('rejects a claimed current ledger without the business schema before changing bytes',()=>{
    const directory=mkdtempSync(join(tmpdir(),'roundtable-r03-ledger-only-'));const path=join(directory,'source.db');
    const raw=new Sqlite(path);raw.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);INSERT INTO schema_migrations VALUES(1,'2026-10-13T00:00:00.000Z'),(2,'2026-10-13T00:00:00.000Z')");raw.close();
    const before=readFileSync(path);const db=new Database(path);
    try {expect(()=>db.initialize()).toThrow(/incomplete/i);db.close();expect(readFileSync(path)).toEqual(before);}
    finally {db.close();rmSync(directory,{recursive:true,force:true});}
  });
  it('verifies and catalogs a recoverable v1 backup before upgrading, without inventing execution inputs',async()=>{
    const f=fixture();const db=new Database(f.path);let raw:Sqlite.Database|undefined;let candidate:Sqlite.Database|undefined;
    try {
      await db.initialize();await db.initialize();
      expect(db.getRun('run')).toMatchObject({task:null,membersSnapshot:null,nextTurnIndex:null,elapsedExecutionMs:null});
      expect(db.getAttempt('request')).toMatchObject({inputSnapshot:null,createdAt:null,startedAt:null,finishedAt:null});
      raw=new Sqlite(f.path,{readonly:true});
      expect(raw.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1,2,3,4,5,6]);
      const receipt=raw.prepare('SELECT id,version,sha256,byte_count,verified_at FROM schema_backups').get() as {id:number;version:number;sha256:string;byte_count:number;verified_at:string};
      expect(receipt.version).toBe(1);expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);expect(receipt.byte_count).toBeGreaterThan(0);expect(receipt.verified_at).toMatch(/^2026-/);
      const restored=await db.prepareRegisteredRestore(receipt.id);
      expect(statSync(restored.path).mode&0o777).toBe(0o600);
      candidate=new Sqlite(restored.path,{readonly:true});
      expect(candidate.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1]);
      expect(candidate.prepare('SELECT content FROM messages').pluck().get()).toBe('original partial');
      expect(()=>candidate!.prepare('SELECT task FROM workflow_runs')).toThrow(/no such column/);
      await expect(db.prepareRegisteredRestore(999)).rejects.toThrow(/verified/);
    } finally {candidate?.close();raw?.close();db.close();f.dispose();}
  });

  it('rolls back a real mid-migration failure and preserves original bytes and the verified backup',async()=>{
    const f=fixture();let raw=new Sqlite(f.path);
    raw.exec("CREATE TRIGGER fail_v2 BEFORE INSERT ON schema_migrations WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'injected v2 failure'); END");raw.close();
    const before=readFileSync(f.path);const db=new Database(f.path);
    try {
      await expect(db.initialize()).rejects.toThrow(/Database migration failed: injected v2 failure/);
      db.close();expect(readFileSync(f.path)).toEqual(before);
      raw=new Sqlite(f.path,{readonly:true});expect(raw.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1]);
      expect(raw.prepare("SELECT name FROM pragma_table_info('workflow_runs') WHERE name='task'").all()).toEqual([]);
      expect(raw.prepare('SELECT content FROM messages').pluck().get()).toBe('original partial');raw.close();
      const files=readdirSync(join(f.directory,'backups')).filter(name=>name.startsWith('backup-')&&name.endsWith('.sqlite3'));
      expect(files).toHaveLength(1);raw=new Sqlite(join(f.directory,'backups',files[0]),{readonly:true});
      expect(raw.pragma('integrity_check',{simple:true})).toBe('ok');expect(raw.prepare('SELECT content FROM messages').pluck().get()).toBe('original partial');
    } finally {if(raw.open)raw.close();db.close();f.dispose();}
  });

  it('upgrades with an active WAL reader, backing up the latest committed partial output',async()=>{
    const f=fixture();const writer=new Sqlite(f.path,{timeout:0});writer.pragma('journal_mode=WAL');writer.pragma('wal_autocheckpoint=0');
    const reader=new Sqlite(f.path);reader.exec('BEGIN');reader.prepare('SELECT content FROM messages').get();
    writer.prepare('UPDATE messages SET content=?').run('latest committed partial');
    expect((writer.pragma('wal_checkpoint(TRUNCATE)') as Array<{busy:number}>)[0].busy).toBe(1);
    const db=new Database(f.path);let backup:Sqlite.Database|undefined;
    try {
      await db.initialize();expect(db.getMessage('message')?.content).toBe('latest committed partial');
      const path=writer.prepare('SELECT path FROM schema_backups').pluck().get() as string;backup=new Sqlite(path,{readonly:true});
      expect(backup.prepare('SELECT content FROM messages').pluck().get()).toBe('latest committed partial');
    } finally {backup?.close();db.close();reader.exec('ROLLBACK');reader.close();writer.close();f.dispose();}
  });

  it.each([{versions:[1,3]},{versions:[1,2,3,4,5,6,7]}])('refuses a gap or newer ledger $versions before altering the original database',({versions})=>{
    const f=fixture();let raw=new Sqlite(f.path);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(versions.at(-1),'2026-10-13T00:00:00.000Z');
    for (const v of versions.slice(1,-1)) raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(v,'2026-10-13T00:00:00.000Z');raw.close();
    const before=readFileSync(f.path);const db=new Database(f.path);
    try {expect(()=>db.initialize()).toThrow(/ledger/);db.close();expect(readFileSync(f.path)).toEqual(before);}
    finally {db.close();f.dispose();}
  });
});
