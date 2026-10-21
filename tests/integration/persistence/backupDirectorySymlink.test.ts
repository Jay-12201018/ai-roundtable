// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath,URL } from 'node:url';
import Sqlite from 'better-sqlite3';
import { afterEach,describe,expect,it } from 'vitest';
import { Database } from '../../../src/main/database/Database';

const baseline=execFileSync('git',['show','135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'});
const sql=baseline.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
const roots:string[]=[];
afterEach(()=>{for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true});});

// A real v1 database whose parent is reached only through a symlinked ancestor.
function linkedV1() {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'roundtable-backup-link-')));roots.push(root);
  const real=join(root,'real');mkdirSync(real,{mode:0o700});
  const linked=join(root,'linked');symlinkSync(real,linked,'dir');
  const raw=new Sqlite(join(real,'source.db'));raw.exec(sql);
  raw.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);INSERT INTO schema_migrations VALUES(1,'2026-10-13T00:00:00.000Z')");raw.close();
  return {root,real,linkedPath:join(linked,'source.db')};
}

describe('migration backup directory with symlinked ancestors',()=>{
  it('accepts a database reached through a symlinked ancestor and catalogs the canonical backup path',async()=>{
    const f=linkedV1();const db=new Database(f.linkedPath);
    try {
      await db.initialize();
      const raw=new Sqlite(join(f.real,'source.db'),{readonly:true});
      try {
        const path=raw.prepare('SELECT path FROM schema_backups').pluck().get() as string;
        expect(path.startsWith(join(f.real,'backups')+'/')).toBe(true);
      } finally {raw.close();}
    } finally {db.close();}
  });

  it('still rejects a backups directory that is itself a symlink, before changing bytes',async()=>{
    const f=linkedV1();const elsewhere=join(f.root,'elsewhere');mkdirSync(elsewhere,{mode:0o700});
    symlinkSync(elsewhere,join(f.real,'backups'),'dir');
    const before=readFileSync(join(f.real,'source.db'));const db=new Database(f.linkedPath);
    try {await expect(db.initialize()).rejects.toThrow(/Unsafe backup directory/);}
    finally {db.close();}
    expect(readFileSync(join(f.real,'source.db'))).toEqual(before);
  });
});
