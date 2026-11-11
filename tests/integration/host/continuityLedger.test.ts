// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type Sqlite from 'better-sqlite3';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { closeFixtures, hostFixture, startFree } from './fixtures';

afterEach(closeFixtures);

const raw = (f: ReturnType<typeof hostFixture>) => (f.db as unknown as { db: Sqlite.Database }).db;

/** A finished 3-turn discussion continued once; `agentId` names one member, otherwise everyone answers. */
async function continued(agentId?: string) {
  const f = hostFixture();
  const { runId } = await startFree(f, { mode: 'automatic', maxTurns: 3 });
  await f.run.waitForIdle(runId);
  const result = f.run.continueDiscussion({ runId, clientRequestId: `continue-${agentId ?? 'all'}`, content: '继续', ...(agentId ? { agentId } : {}) });
  await f.run.waitForIdle(runId);
  return { f, runId, result, db: raw(f) };
}

/** Changes a protected row the way a damaged file could, with its trigger restored afterwards. */
function bypassing(db: Sqlite.Database, trigger: string, sql: string, ...values: unknown[]) {
  const definition = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").pluck().get(trigger) as string;
  db.exec(`DROP TRIGGER ${trigger}`);
  db.prepare(sql).run(...values);
  db.exec(definition);
}

describe('migration 10: run_continuations is append-only evidence (D111)', () => {
  it('refuses updates and deletes', async () => {
    const { db } = await continued();
    expect(() => db.prepare("UPDATE run_continuations SET agent_ids_json='[\"a\"]'").run()).toThrow(/append-only/u);
    expect(() => db.prepare('UPDATE run_continuations SET elapsed_base_ms=0').run()).toThrow(/append-only/u);
    expect(() => db.prepare('DELETE FROM run_continuations').run()).toThrow(/append-only/u);
    expect(validateDatabase(db).schemaVersion).toBe(17);
  });

  it('accepts only an interjection of the same discussion as its action', async () => {
    const { f, runId, db } = await continued();
    const insert = (actionId: string, run = runId) => db.prepare("INSERT INTO run_continuations VALUES(?,?,'[\"a\"]',0,'2026-10-27T00:00:00.000Z')").run(actionId, run);
    // An Override is not an interjection.
    const second = await startFree(f, { mode: 'step', maxTurns: 3 });
    await f.run.waitForIdle(second.runId);
    const override = await f.command({ runId: second.runId, kind: 'setOverride', agentId: 'b' });
    expect(() => insert(override.actionId, second.runId)).toThrow(/Invalid continuation identity/u);
    // Another discussion's interjection, or no action at all.
    const interjection = await f.command({ runId: second.runId, kind: 'interject', content: '别的讨论' });
    expect(() => insert(interjection.actionId, runId)).toThrow(/Invalid continuation identity/u);
    expect(() => insert('no-such-action')).toThrow(/Invalid continuation identity/u);
    // The same discussion's interjection is the only valid owner (here: a second continuation of the other Run).
    expect(() => insert(interjection.actionId, second.runId)).not.toThrow();
    expect(f.db.listContinuations(runId)).toHaveLength(1);
  });

  it('lets recovery validation find damaged continuation records', async () => {
    // An answer by a member the continuation did not ask.
    const outside = await continued('a');
    bypassing(outside.db, 'run_continuation_immutable', "UPDATE run_continuations SET agent_ids_json='[\"b\"]' WHERE action_id=?", outside.result.actionId);
    expect(outside.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='run_continuation_immutable'").get()).toBeTruthy();
    expect(() => validateDatabase(outside.db)).toThrow(/Invalid continuation Turn/u);

    // More answers than the continuation has members.
    const extra = await continued('a');
    const planTurn = extra.f.run.getSnapshot(extra.runId).turns.find(turn => turn.agentId === 'a' && !turn.overrideActionId)!;
    extra.db.prepare('UPDATE turns SET override_action_id=? WHERE id=?').run(extra.result.actionId, planTurn.turnId);
    expect(() => validateDatabase(extra.db)).toThrow(/Invalid continuation Turn/u);

    // A missing protection trigger.
    for (const trigger of ['run_continuation_insert', 'run_continuation_immutable', 'run_continuation_no_delete']) {
      const { db } = await continued();
      db.exec(`DROP TRIGGER ${trigger}`);
      expect(() => validateDatabase(db)).toThrow(/Missing continuation protection/u);
    }
  });
});
