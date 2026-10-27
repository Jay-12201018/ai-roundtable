// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { closeFixtures, hostFixture, publicHistory, roomId, startFree, startWorkflow, systemTexts } from './fixtures';
import { revisionRuleText } from '../../../src/main/context/transcript';

afterEach(closeFixtures);

const speakers = (f: ReturnType<typeof hostFixture>, runId: string) => f.run.getSnapshot(runId).turns.map(turn => turn.agentId);
let clientCounter = 0;
const continueWith = async (f: ReturnType<typeof hostFixture>, runId: string, content: string, agentId?: string, clientRequestId = `continue-${++clientCounter}`) =>
  f.run.continueDiscussion({ runId, clientRequestId, content, ...(agentId ? { agentId } : {}) });

describe('D110 an @Override inserts a Turn instead of replacing the planned speaker', () => {
  it('after round 2 of a 3-round discussion, the named member speaks once and the planned synthesizer still speaks', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'step', maxTurns: 3 });
    await f.run.waitForIdle(run.runId);
    await f.run.step(run.runId);
    expect(speakers(f, run.runId)).toEqual(['a', 'b']);
    const named = await f.command({ runId: run.runId, kind: 'setOverride', agentId: 'b' });
    await f.command({ runId: run.runId, kind: 'interject', content: '@成员 b 检查一下' });
    await f.run.resumeRun(run.runId);
    const done = f.run.getSnapshot(run.runId);
    expect(done.status).toBe('completed');
    expect(done.turns.map(turn => [turn.agentId, turn.overrideActionId])).toEqual([['a', undefined], ['b', undefined], ['b', named.actionId], ['c', undefined]]);
    // The synthesizer sees everything, the inserted check included.
    expect(publicHistory(f.provider.inputs[3]).map(item => item.speaker)).toEqual(['成员 a', '成员 b', '主持人', '成员 b']);
  });

  it('takes an Override named during the last planned Turn before the discussion ends', async () => {
    const f = hostFixture();
    f.provider.hold.add(1);
    const run = await startFree(f, { mode: 'automatic', maxTurns: 2 });
    await f.provider.started(1);
    // The plan's turns are used up once this Turn ends; the named member is still inserted.
    await f.command({ runId: run.runId, kind: 'setOverride', agentId: 'c' });
    f.provider.release(1);
    await f.run.waitForIdle(run.runId);
    const done = f.run.getSnapshot(run.runId);
    expect(done.status).toBe('completed');
    expect(done.turns.map(turn => turn.agentId)).toEqual(['a', 'b', 'c']);
    expect(done.host?.override).toBeUndefined();
  });

  it('in a workflow, the inserted Turn takes no step and does not use up the turn limit', async () => {
    const f = hostFixture();
    const run = await startWorkflow(f, 'review-revision');
    await f.run.waitForIdle(run.runId);
    const plan = f.run.getSnapshot(run.runId).workflow!;
    await f.command({ runId: run.runId, kind: 'setOverride', agentId: 'b' });
    await f.run.resumeRun(run.runId);
    const done = f.run.getSnapshot(run.runId);
    expect(done.status).toBe('completed');
    expect(done.workflow).toMatchObject({ completedTurns: plan.totalTurns, totalTurns: plan.totalTurns });
    expect(done.workflow?.limitReason).toBeUndefined();
    expect(done.turns.filter(turn => turn.overrideActionId)).toHaveLength(1);
    expect(done.turns).toHaveLength(plan.totalTurns + 1);
  });
});

describe('D111 continuing a finished discussion in the same Run', () => {
  it('lets one named member answer the host with the whole history, then ends again', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'automatic', maxTurns: 3 });
    await f.run.waitForIdle(run.runId);
    const before = f.run.getSnapshot(run.runId);
    expect(before.status).toBe('completed');
    expect(f.run.previewContinuation({ runId: run.runId, agentId: 'c', content: '@成员 c 请总结' })).toEqual({ runId: run.runId, available: true, agentIds: ['c'], cost: { kind: 'free' } });
    const result = await continueWith(f, run.runId, '@成员 c 请总结', 'c', 'summary-please');
    expect(result).toMatchObject({ runId: run.runId, agentIds: ['c'], duplicate: false });
    await f.run.waitForIdle(run.runId);
    const done = f.run.getSnapshot(run.runId);
    expect(done.runId).toBe(before.runId);
    expect(done.status).toBe('completed');
    expect(done.turns.map(turn => [turn.agentId, turn.overrideActionId])).toEqual([['a', undefined], ['b', undefined], ['c', undefined], ['c', result.actionId]]);
    expect(done.continuations).toEqual([{ actionId: result.actionId, messageId: result.messageId, agentIds: ['c'], createdAt: expect.any(String) }]);
    expect(done.messages.find(message => message.id === result.messageId)).toMatchObject({ senderName: '主持人', content: '@成员 c 请总结', status: 'completed' });
    // C sees the earlier discussion and the host's words; its own earlier reply stays its own.
    const history = publicHistory(f.provider.inputs[3]);
    expect(history.map(item => [item.speaker, item.own])).toEqual([['成员 a', false], ['成员 b', false], ['成员 c', true], ['主持人', false]]);
    expect(history.at(-1)?.publicText).toBe('@成员 c 请总结');
    // A repeated delivery returns the same continuation and sends nothing more.
    expect(await continueWith(f, run.runId, '@成员 c 请总结', 'c', 'summary-please')).toEqual({ ...result, duplicate: true });
    await expect(continueWith(f, run.runId, '另一句话', undefined, 'summary-please')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.provider.inputs).toHaveLength(4);
    // The event stream of the same Run carries the change; the cursor only moves forward.
    expect(done.sequence).toBeGreaterThan(before.sequence);
    expect(f.run.subscribe(run.runId, before.sequence).events.map(event => event.type)).toContain('host_updated');
  });

  it('without a name, every member answers once in roster order and later answers see the earlier ones', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'automatic', maxTurns: 2 });
    await f.run.waitForIdle(run.runId);
    const result = await continueWith(f, run.runId, '再各说一句：最大的风险是什么？');
    expect(result.agentIds).toEqual(['a', 'b', 'c']);
    await f.run.waitForIdle(run.runId);
    const done = f.run.getSnapshot(run.runId);
    expect(done.status).toBe('completed');
    expect(done.turns.map(turn => turn.agentId)).toEqual(['a', 'b', 'a', 'b', 'c']);
    expect(done.turns.slice(2).every(turn => turn.overrideActionId === result.actionId)).toBe(true);
    expect(publicHistory(f.provider.inputs[4]).map(item => item.speaker)).toEqual(['成员 a', '成员 b', '主持人', '成员 a', '成员 b']);
    // A continued discussion does not go back to its plan once the continuation is answered.
    expect(f.run.previewContinuation({ runId: run.runId }).available).toBe(true);
  });

  it('refuses while the discussion is still going, and leaves nothing behind', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'step', maxTurns: 3 });
    await f.run.waitForIdle(run.runId);
    expect(f.run.previewContinuation({ runId: run.runId })).toMatchObject({ available: false, reason: 'not_finished' });
    await expect(continueWith(f, run.runId, '继续')).rejects.toMatchObject({ code: 'invalid_state' });
    expect(f.db.listHostActions(run.runId)).toEqual([]);
    expect(f.db.listContinuations(run.runId)).toEqual([]);
    expect(f.run.getSnapshot(run.runId).messages).toHaveLength(1);
  });

  it('answers only with members still enabled, and refuses a named member who is not', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'automatic', maxTurns: 3 });
    await f.run.waitForIdle(run.runId);
    f.db.archiveAgent('b');
    expect(f.run.previewContinuation({ runId: run.runId }).agentIds).toEqual(['a', 'c']);
    expect(f.run.previewContinuation({ runId: run.runId, agentId: 'b' })).toMatchObject({ available: false, reason: 'member_unavailable' });
    await expect(continueWith(f, run.runId, '@成员 b 你怎么看', 'b')).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(continueWith(f, run.runId, '问外人', 'not-a-member')).rejects.toMatchObject({ code: 'not_found' });
    expect(f.db.listContinuations(run.runId)).toEqual([]);
  });

  it('continues a stopped discussion without resuming the rest of its plan', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'step', maxTurns: 6 });
    await f.run.waitForIdle(run.runId);
    await f.run.stop(run.runId);
    expect(f.run.getSnapshot(run.runId).status).toBe('cancelled');
    const result = await continueWith(f, run.runId, '只请成员 c 说一句', 'c');
    await f.run.waitForIdle(run.runId);
    // The Run was in step mode: it pauses after the answer, and resuming finds nothing more to do.
    const paused = f.run.getSnapshot(run.runId);
    expect(paused.turns.map(turn => turn.agentId)).toEqual(['a', 'c']);
    expect(paused.turns[1].overrideActionId).toBe(result.actionId);
    if (paused.status === 'paused') await f.run.resumeRun(run.runId);
    expect(f.run.getSnapshot(run.runId)).toMatchObject({ status: 'completed' });
    expect(speakers(f, run.runId)).toEqual(['a', 'c']);
  });

  it('gives a continuation its own duration allowance', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'automatic', maxTurns: 1 });
    await f.run.waitForIdle(run.runId);
    // The first part used the whole allowance; continuing still has a fresh one.
    f.db.updateRunProgress(run.runId, { elapsedExecutionMs: 300000 });
    await continueWith(f, run.runId, '继续', 'b');
    await f.run.waitForIdle(run.runId);
    expect(f.run.getSnapshot(run.runId)).toMatchObject({ status: 'completed' });
    expect(speakers(f, run.runId)).toEqual(['a', 'b']);
  });

  it('accepts an @Override during a continuation round and then finishes the round', async () => {
    const f = hostFixture();
    f.provider.hold.add(2);
    const run = await startFree(f, { mode: 'automatic', maxTurns: 2 });
    await f.run.waitForIdle(run.runId);
    await continueWith(f, run.runId, '大家再说一轮');
    await f.provider.started(2);
    await f.command({ runId: run.runId, kind: 'setOverride', agentId: 'c' });
    f.provider.release(2);
    await f.run.waitForIdle(run.runId);
    expect(speakers(f, run.runId)).toEqual(['a', 'b', 'a', 'c', 'b', 'c']);
  });

  it('is offered in a workflow Run too, outside the plan and without a stage requirement', async () => {
    const f = hostFixture();
    const run = await startWorkflow(f, 'review-revision', { mode: 'automatic' });
    await f.run.waitForIdle(run.runId);
    const plan = f.run.getSnapshot(run.runId).workflow!;
    const result = await continueWith(f, run.runId, '@成员 a 按审查意见再改一版', 'a');
    await f.run.waitForIdle(run.runId);
    const done = f.run.getSnapshot(run.runId);
    expect(done.status).toBe('completed');
    expect(done.workflow).toMatchObject({ completedTurns: plan.totalTurns, totalTurns: plan.totalTurns });
    expect(done.turns.at(-1)).toMatchObject({ agentId: 'a', overrideActionId: result.actionId });
    expect(systemTexts(f.provider.inputs.at(-1)!).some(text => text.includes('当前阶段'))).toBe(false);
  });
});

describe('D112 the revision rule is sent only with revision notes', () => {
  it('leaves it out of an ordinary discussion and sends it once a host edit is in the context', async () => {
    const f = hostFixture();
    const run = await startFree(f, { mode: 'step', maxTurns: 3 });
    await f.run.waitForIdle(run.runId);
    await f.run.step(run.runId);
    expect(f.provider.inputs.every(input => !JSON.stringify(input.messages).includes('写于前序修改之前'))).toBe(true);
    const first = f.run.getSnapshot(run.runId).turns[0];
    await f.command({ runId: run.runId, kind: 'editMessage', messageId: first.messageId!, content: '修订后的开场' });
    await f.run.step(run.runId);
    expect(systemTexts(f.provider.inputs[2]).some(text => text.includes(revisionRuleText))).toBe(true);
  });
});

void roomId;
