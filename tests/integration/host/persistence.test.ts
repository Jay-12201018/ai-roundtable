// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { HostService } from '../../../src/main/host/HostService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { migration2 } from '../../../src/main/database/migrations/v2';
import { migration3 } from '../../../src/main/database/migrations/v3';
import { migration4 } from '../../../src/main/database/migrations/v4';
import { migration5 } from '../../../src/main/database/migrations/v5';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { members, roomId, ScriptedProvider } from './fixtures';

const baseline = execFileSync('git', ['show', '135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'], { encoding: 'utf8' });
const migration1 = baseline.match(/const migrations = \[\s*`([\s\S]*?)`/)![1];
const directories: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function tempFile() {
  const directory = mkdtempSync(join(tmpdir(), 'roundtable-r12-'));
  directories.push(directory);
  return join(directory, 'owned.db');
}
function open(path: string, provider = new ScriptedProvider()) {
  const db = new Database(path);
  const pending = db.initialize();
  if (pending) throw new Error('Expected a current schema');
  db.markInFlightRunsInterrupted();
  const run = new RunService(db, provider, createPublicMessagesBuilder());
  const host = new HostService(db, run);
  let counter = 0;
  const command = (input: Record<string, unknown>) => host.command({ clientRequestId: `restart-${++counter}-${Math.random()}`, ...input } as never);
  return { db, run, host, provider, command };
}

describe('R12 persistence', () => {
  it('keeps branches, selections, instructions, a queued Override and partial versions across an unclean restart with zero requests', async () => {
    const path = tempFile();
    const live = open(path);
    live.db.insertRoom({ id: roomId, name: 'Restart', objective: '' });
    for (const member of members) live.db.insertAgent({ ...member, roomId });
    const started = await live.run.start({ roomId, task: 'Persist versions', workflowSnapshot: {}, mode: 'step', maxTurns: 6 });
    const runId = started.runId;
    await live.run.waitForIdle(runId); await live.run.step(runId);
    const turns = live.run.getSnapshot(runId).turns;
    await live.command({ runId, kind: 'setInstruction', content: '保持简洁' });
    await live.command({ runId, kind: 'interject', content: '主持人插话' });
    await live.command({ runId, kind: 'editMessage', messageId: turns[0].messageId, content: '修订开场' });
    await live.command({ runId, kind: 'setOverride', agentId: 'c' });
    live.provider.hold.add(2);
    await live.command({ runId, kind: 'regenerateMessage', messageId: turns[1].messageId });
    await live.provider.started(2);
    const before = live.run.getSnapshot(runId);
    expect(before.host?.generation).toBeDefined();

    // A second process opens the same file while the regeneration is still streaming: an unclean exit.
    const restarted = open(path);
    cleanups.push(async () => { live.provider.release(2); await live.run.shutdown().catch(() => {}); live.db.close(); });
    cleanups.push(async () => { await restarted.run.shutdown(); restarted.db.close(); });
    const after = restarted.run.getSnapshot(runId);
    expect(after.status).toBe('interrupted');
    expect(restarted.provider.inputs).toEqual([]);
    const job = after.versions!.find(version => version.origin === 'regenerate')!;
    expect(job.active).toBe(false);
    expect(after.messages.find(message => message.id === job.messageId)).toMatchObject({ status: 'aborted', content: 'answer 2 @Override 成员 b @Stop' });
    expect(after.attempts!.find(attempt => attempt.messageId === job.messageId)?.status).toBe('interrupted');
    expect(after.host?.generation).toBeUndefined();
    expect(after.versions!.map(({ messageId, slotId, versionNumber, origin, active, parentMessageId, actionId }) => ({ messageId, slotId, versionNumber, origin, active, parentMessageId, actionId })))
      .toEqual(before.versions!.map(({ messageId, slotId, versionNumber, origin, active, parentMessageId, actionId }) => ({ messageId, slotId, versionNumber, origin, active, parentMessageId, actionId })));
    expect(after.turns.map(turn => [turn.turnId, turn.messageId, turn.status])).toEqual(before.turns.map(turn => [turn.turnId, turn.messageId, turn.status]));
    expect(after.host?.instructions).toEqual(before.host?.instructions);
    expect(after.host?.override).toEqual(before.host?.override);
    expect(after.versions!.find(version => version.messageId === turns[1].messageId)!.affectedBy).toEqual([turns[0].messageId]);
    expect(validateDatabase(new Sqlite(path, { readonly: true })).schemaVersion).toBe(12);
    // Nothing resends automatically; resuming is an explicit host action that consumes the queued Override.
    await restarted.run.recoverInterruptedRun(runId, 'resume');
    const resumed = restarted.run.getSnapshot(runId);
    expect(resumed.turns.map(turn => turn.agentId)).toEqual(['a', 'b', 'c']);
    expect(resumed.turns[2].overrideActionId).toBe(before.host!.override!.actionId);
    expect(restarted.provider.inputs).toHaveLength(1);
  });

  it('backfills pre-R12 Turns as version slots with their latest Attempt active and no invented basis', async () => {
    const path = tempFile();
    const raw = new Sqlite(path);
    [migration1, migration2, migration3, migration4, migration5].forEach((migration, index) => {
      raw.exec(migration);
      if (index === 0) raw.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
      raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(index + 1, '2026-10-20T00:00:00.000Z');
    });
    const at = '2026-10-20T00:00:00.000Z';
    const memberSnapshot = JSON.stringify([{ agentId: 'a', displayName: '成员 a', roleTemplateId: 'assistant', systemPrompt: '', providerId: null, modelId: 'mock', displayOrder: 0 }]);
    raw.prepare('INSERT INTO rooms(id,name,objective,created_at,updated_at) VALUES(?,?,?,?,?)').run(roomId, 'Legacy', '', at, at);
    raw.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,display_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('a', roomId, '成员 a', 'assistant', 0, at, at);
    raw.prepare("INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at,task,members_snapshot,next_turn_index,elapsed_execution_ms) VALUES('run',?, 'completed','{}',?,?,'Legacy task',?,2,10)").run(roomId, at, at, memberSnapshot);
    const message = raw.prepare("INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at,sort_key) VALUES(?,?,'run',?,?,?,?,?,?,?,?)");
    const input = (requestId: string, last: string) => JSON.stringify({ requestId, modelId: 'mock', outputTokenLimit: 16, agentRole: 'assistant', turnIndex: 0, messages: [{ role: 'user', content: last }] });
    raw.prepare("INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,created_at,updated_at) VALUES('t1','run','a','completed','r1',0,?,?)").run(at, at);
    raw.prepare("INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,created_at,updated_at) VALUES('t2','run','a','completed','r3',1,?,?)").run(at, at);
    message.run('m1', roomId, 't1', 'agent', '成员 a', 'partial', 'aborted', at, at, 1);
    message.run('m2', roomId, 't1', 'agent', '成员 a', 'partial and rest', 'completed', at, at, 2);
    message.run('m3', roomId, null, 'user', '主持人', 'legacy host text', 'completed', at, at, 3);
    message.run('m4', roomId, 't2', 'agent', '成员 a', 'second', 'completed', at, at, 4);
    raw.prepare("UPDATE persistence_counters SET value=4 WHERE name='message'").run();
    const attempt = raw.prepare("INSERT INTO request_attempts(request_id,run_id,turn_id,message_id,attempt_index,status,input_snapshot) VALUES(?,'run',?,?,?,?,?)");
    attempt.run('r1', 't1', 'm1', 0, 'aborted', input('r1', 'Legacy task'));
    attempt.run('r2', 't1', 'm2', 1, 'completed', input('r2', 'Continue the previous response from where it stopped.'));
    attempt.run('r3', 't2', 'm4', 0, 'completed', input('r3', 'Legacy task'));
    const contents = raw.prepare('SELECT id,content,status FROM messages ORDER BY sort_key').all();
    raw.close();

    const db = new Database(path);
    cleanups.push(() => db.close());
    await db.initialize();
    const run = new RunService(db, new ScriptedProvider(), createPublicMessagesBuilder());
    const snapshot = run.getSnapshot('run');
    expect(snapshot.versions!.map(v => [v.messageId, v.slotId, v.versionNumber, v.origin, v.active, v.parentMessageId ?? null, v.affectedBy])).toEqual([
      ['m1', 't1', 1, 'original', false, null, []], ['m2', 't1', 2, 'continue', true, 'm1', []],
      ['m3', 'm3', 1, 'original', true, null, []], ['m4', 't2', 1, 'original', true, null, []],
    ]);
    expect(snapshot.turns.map(turn => turn.messageId)).toEqual(['m2', 'm4']);
    const check = new Sqlite(path, { readonly: true });
    try {
      expect(validateDatabase(check).schemaVersion).toBe(12);
      expect(check.prepare('SELECT id,content,status FROM messages ORDER BY sort_key').all()).toEqual(contents);
      expect(check.prepare('SELECT COUNT(*) FROM message_versions WHERE basis_json IS NOT NULL').pluck().get()).toBe(0);
    } finally { check.close(); }
  });

  it('D111: a continuation interrupted by an unclean exit resumes only by explicit decision and never resends by itself', async () => {
    const path = tempFile();
    const live = open(path);
    live.db.insertRoom({ id: roomId, name: 'Restart', objective: '' });
    for (const member of members) live.db.insertAgent({ ...member, roomId });
    const { runId } = await live.run.start({ roomId, task: 'Continue after restart', workflowSnapshot: {}, mode: 'automatic', maxTurns: 1 });
    await live.run.waitForIdle(runId);
    live.provider.hold.add(2);
    const continued = live.run.continueDiscussion({ runId, clientRequestId: 'continue-1', content: '大家再说一轮' });
    await live.provider.started(2);
    const restarted = open(path);
    cleanups.push(async () => { live.provider.release(2); await live.run.shutdown().catch(() => {}); live.db.close(); });
    cleanups.push(async () => { await restarted.run.shutdown(); restarted.db.close(); });
    const after = restarted.run.getSnapshot(runId);
    expect(after.status).toBe('interrupted');
    expect(after.continuations).toEqual([{ actionId: continued.actionId, messageId: continued.messageId, agentIds: ['a', 'b', 'c'], createdAt: expect.any(String) }]);
    expect(after.turns.map(turn => [turn.agentId, turn.status])).toEqual([['a', 'completed'], ['a', 'completed'], ['b', 'interrupted']]);
    expect(restarted.provider.inputs).toEqual([]);
    expect(validateDatabase(new Sqlite(path, { readonly: true })).schemaVersion).toBe(12);
    // The interrupted answer needs an explicit retry; the rest of the round then follows, and nothing else is sent.
    await expect(restarted.run.recoverInterruptedRun(runId, 'resume')).rejects.toMatchObject({ code: 'invalid_state' });
    await restarted.run.recoverInterruptedRun(runId, 'retry');
    const done = restarted.run.getSnapshot(runId);
    expect(done.status).toBe('completed');
    expect(done.turns.map(turn => turn.agentId)).toEqual(['a', 'a', 'b', 'c']);
    expect(restarted.provider.inputs).toHaveLength(2);
  });
});
