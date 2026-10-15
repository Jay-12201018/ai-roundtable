// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { diskFixture } from '../../unit/persistence/fixtures';
import { createVerifiedBackup } from '../../../src/main/database/backup/createVerifiedBackup';
import { prepareRestore } from '../../../src/main/database/recovery/prepareRestore';

const state = vi.hoisted(()=>({count:0,controller:new AbortController()}));
vi.mock('../../../src/main/database/backup/createVerifiedBackup',async importOriginal=>{
  const real = await importOriginal<typeof import('../../../src/main/database/backup/createVerifiedBackup')>();
  return {...real,fileSha256:async(path:string)=>{
    const hash = await real.fileSha256(path);
    if (++state.count===2) state.controller.abort();
    return hash;
  }};
});

it('rejects cancellation during final restore verification and cleans only its candidate',async()=>{
  const fixture = diskFixture();
  try {
    const backup = await createVerifiedBackup(fixture.db,fixture.directory);
    await expect(prepareRestore(backup,fixture.directory,{signal:state.controller.signal})).rejects.toThrow(/cancel/i);
    expect(readdirSync(fixture.directory).some(name=>name.startsWith('.roundtable-restore-'))).toBe(false);
    expect(readdirSync(fixture.directory)).toContain(backup.path.split('/').at(-1));
  } finally {fixture.dispose();}
});
