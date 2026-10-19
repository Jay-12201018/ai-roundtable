import { describe, expect, it } from 'vitest';
import { compileWorkflow, readWorkflowSnapshot, workflowStageInstruction } from '../../../src/main/workflow';
import { config, members, roomId } from './fixtures';

describe('finite workflow compiler', () => {
  it.each([
    ['free-chat', ['c', 'a', 'b', 'c', 'a', 'b']],
    ['two-model-dialogue', ['b', 'a', 'b', 'a', 'b', 'a']],
    ['review-revision', ['a', 'b', 'a', 'b', 'c']],
    ['deep-debate', ['a', 'b', 'c', 'c', 'b', 'a', 'c', 'b', 'a', 'a', 'b', 'c']],
  ])('%s compiles the configured order, including reused members', (template, expected) => {
    const snapshot = compileWorkflow(config(template), roomId, members);
    expect(snapshot.steps.map(step => step.agentId)).toEqual(expected);
    expect(snapshot.steps.map(step => step.index)).toEqual(expected.map((_, index) => index));
    expect(snapshot.steps.every(step => workflowStageInstruction(step.kind).length > 0)).toBe(true);
  });

  it('keeps the five distinct revision stages and trusted stage instructions', () => {
    const snapshot = compileWorkflow(config(), roomId, members);
    expect(snapshot.steps.map(step => step.kind)).toEqual(['draft', 'review', 'revise', 'rereview', 'finalize']);
    expect(workflowStageInstruction('revise')).toContain('审查');
    expect(workflowStageInstruction('rereview')).toContain('修订');
  });

  it('accepts a declared terminal stage and excludes its successors', () => {
    const input = { ...config(), endCondition: { type: 'after_stage', stageId: 'rereview' } };
    const snapshot = compileWorkflow(input, roomId, members);
    expect(snapshot.steps).toHaveLength(4);
    expect(snapshot.steps.at(-1)?.kind).toBe('rereview');
  });

  it('accepts multiple explicit chat stages in their declared order', () => {
    const input = config('free-chat');
    input.stages = [{ id: 'second', kind: 'discussion', memberIds: ['b'], rounds: 1 }, { id: 'first', kind: 'discussion', memberIds: ['a'], rounds: 2 }];
    expect(compileWorkflow(input, roomId, members).steps.map(step => step.stageId)).toEqual(['second', 'first', 'first']);
  });

  it('isolates configuration, member identities and plan from later edits', () => {
    const input = config(); const agents = structuredClone(members);
    const snapshot = compileWorkflow(input, roomId, agents);
    input.stages[0].memberIds[0] = 'c'; agents[0].displayName = 'Changed'; agents[0].systemPrompt = 'Changed';
    expect(snapshot.steps[0].agentId).toBe('a');
    expect(snapshot.members[0].displayName).toBe('成员 a');
    expect(snapshot.members[0].systemPrompt).toBe('Role a');
    expect(Object.isFrozen(snapshot.config.stages[0].memberIds)).toBe(true);
    expect(Object.isFrozen(snapshot.steps[0])).toBe(true);
    expect(readWorkflowSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('rejects a tampered or unknown snapshot without reinterpreting legacy decoration', () => {
    const snapshot = compileWorkflow(config(), roomId, members);
    for (const value of [
      { ...snapshot, version: 2 },
      { templateId: 'draft-review-finalize', version: 1 },
      { ...snapshot, steps: snapshot.steps.slice(1) },
      { ...snapshot, members: [...snapshot.members, snapshot.members[0]] },
      { ...snapshot, steps: snapshot.steps.map((step, i) => i === 0 ? { ...step, agentId: 'b' } : step) },
    ]) expect(() => readWorkflowSnapshot(value)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it.each<[string, (c: ReturnType<typeof config>) => void]>([
    ['unknown member', (c: ReturnType<typeof config>) => { c.stages[0].memberIds = ['missing']; }],
    ['duplicate member', c => { c.stages[0].memberIds = ['a', 'a']; }],
    ['empty participants', c => { c.stages[0].memberIds = []; }],
    ['duplicate stages', c => { c.stages[1].id = c.stages[0].id; }],
    ['wrong stage order', c => { c.stages.reverse(); }],
    ['unknown template', c => { c.templateId = 'code-execution'; }],
    ['unknown kind', c => { c.stages[0].kind = 'evaluate'; }],
    ['zero rounds', c => { c.stages[0].rounds = 0; }],
    ['unbounded rounds', c => { c.stages[0].rounds = Infinity; }],
    ['fractional rounds', c => { c.stages[0].rounds = 1.5; }],
    ['zero turns', c => { c.limits.maxTurns = 0; }],
    ['exceeded turns', c => { c.limits.maxTurns = 4; }],
    ['zero duration', c => { c.limits.maxDurationMs = 0; }],
    ['negative output', c => { c.limits.outputTokenLimit = -1; }],
  ])('rejects %s before execution', (_label, mutate) => {
    const input = config(); mutate(input);
    expect(() => compileWorkflow(input, roomId, members)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('rejects absent bounds, dynamic branches, credentials and arbitrary fields safely', () => {
    const input = config();
    for (const value of [
      { ...input, limits: undefined }, { ...input, next: 'while true' },
      { ...input, endCondition: { type: 'model_says_stop' } },
      { ...input, endCondition: { type: 'after_stage', stageId: 'missing' } },
      { ...input, apiKey: 'fixture-private-value' },
      { ...input, stages: input.stages.map(stage => ({ ...stage, next: stage.id })) },
    ]) {
      try { compileWorkflow(value, roomId, members); expect.fail('accepted invalid configuration'); }
      catch (error) { expect(error).toMatchObject({ code: 'invalid_input' }); expect(String(error)).not.toContain('fixture-private-value'); }
    }
  });

  it.each(['disabled', 'archived', 'other_room', 'duplicate'])( 'rejects %s member evidence', reason => {
    const agents = structuredClone(members);
    if (reason === 'disabled') agents[0].enabled = false;
    if (reason === 'archived') agents[0].archivedAt = '2026-10-20T00:00:00Z';
    if (reason === 'other_room') agents[0].roomId = 'other-room';
    if (reason === 'duplicate') agents.push(agents[0]);
    expect(() => compileWorkflow(config(), roomId, agents)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('enforces cardinality, bounded expansion and end condition at configuration time', () => {
    const dialogue = config('two-model-dialogue'); dialogue.stages[0].memberIds.push('c');
    const debate = config('deep-debate'); debate.stages[1].memberIds = ['a'];
    const enormous = config('free-chat'); enormous.stages = Array.from({ length: 16 }, (_, i) => ({ id: `stage-${i}`, kind: 'discussion', memberIds: ['a', 'b', 'c'], rounds: 32 }));
    for (const input of [dialogue, debate, enormous, { ...config(), version: 2 }]) {
      expect(() => compileWorkflow(input, roomId, members)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    }
  });

  it('keeps a dialogue to the same two members even across multiple ordered stages', () => {
    const input = config('two-model-dialogue');
    input.stages.push({ id: 'reply', kind: 'dialogue', memberIds: ['a', 'c'], rounds: 1 });
    expect(() => compileWorkflow(input, roomId, members)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    input.stages[1].memberIds = ['a', 'b'];
    expect(compileWorkflow(input, roomId, members).steps.slice(-2).map(s => s.agentId)).toEqual(['a', 'b']);
  });
});
