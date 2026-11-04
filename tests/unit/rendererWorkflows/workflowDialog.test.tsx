import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowDialog, createWorkflowDraft, readRoomWorkflow, workflowConfigFromDraft, writeRoomWorkflow, type WorkflowCheck, type WorkflowDraft } from '../../../src/renderer/features/workflows';
import { workflowProgressForFeature } from '../../../src/renderer/features/workflows/productionAdapter';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { deferred } from '../rendererSubscriptions/fixtures';

const members = [{ id: 'a', name: '起草者', enabled: true, role: '起草' }, { id: 'b', name: '审查者', enabled: true, role: '审查' }, { id: 'c', name: '综合者', enabled: true, role: '综合' }, { id: 'x', name: '停用成员', enabled: false, role: '审查' }];
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });
const open = (check: (draft: WorkflowDraft) => Promise<WorkflowCheck> = async () => ({ ok: true, summary: '预计 3 回合。' })) => {
  const onCheck = vi.fn(check); const onSave = vi.fn(() => true); const onClose = vi.fn();
  render(<WorkflowDialog roomName="房间" members={members} onCheck={onCheck} onSave={onSave} onClose={onClose} />);
  return { onCheck, onSave, onClose };
};

describe('讨论方式 dialog', () => {
  it('builds finite defaults; the review chain picks members by their role', () => {
    for (const template of ['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'] as const) {
      const draft = createWorkflowDraft(template, members);
      expect(draft.phases.flatMap(phase => phase.participants)).not.toContain('x');
      // Time grows with the turns, a minute each and five at least, so a default flow can finish on a real model.
      const turns = draft.phases.reduce((total, phase) => total + phase.participants.length * Number(phase.repeat), 0);
      expect(workflowConfigFromDraft(draft).limits).toEqual({ maxTurns: 12, maxDurationMs: Math.max(5, turns) * 60000, outputTokenLimit: 8192 });
    }
    expect(createWorkflowDraft('review-revision', [members[2], members[1], members[0]]).phases.map(phase => phase.participants[0])).toEqual(['a', 'b', 'a', 'b', 'a']);
  });
  it('checks every change with Main and saves only a checked mode', async () => {
    const { onCheck, onSave } = open();
    await screen.findByText('已核对：预计 3 回合。', undefined, { timeout: 2000 });
    expect(onCheck).toHaveBeenLastCalledWith(expect.objectContaining({ template: 'free-chat', phases: [expect.objectContaining({ participants: ['a', 'b', 'c'] })] }));
    fireEvent.click(screen.getByRole('button', { name: /^审查修订链/u }));
    expect((screen.getByRole('button', { name: '用于这个房间' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(onCheck).toHaveBeenLastCalledWith(expect.objectContaining({ template: 'review-revision' })), { timeout: 2000 });
    // The last stage ends the plan anyway: only the four earlier ones offer to end there.
    expect(within(screen.getByRole('list', { name: '阶段与成员' })).getAllByRole('button', { name: '在此结束' })).toHaveLength(4);
    fireEvent.click(within(screen.getByRole('list', { name: '阶段与成员' })).getAllByRole('button', { name: '在此结束' })[3]);
    expect(document.body.textContent).toContain('复审后结束');
    expect(document.body.textContent).toContain('综合者不在这个流程里，这次不会发言；需要时可以在讨论中生成摘要。');
    await waitFor(() => expect((screen.getByRole('button', { name: '用于这个房间' }) as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '用于这个房间' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ template: 'review-revision', finishAt: 'rereview' }));
  });
  it('says what is wrong locally without asking Main, and shows Main’s refusal in words', async () => {
    const { onCheck } = open(async () => ({ ok: false, errors: ['按现在的成员和限制排不出这个流程。'] }));
    fireEvent.change(screen.getByLabelText('最多回合'), { target: { value: '0' } });
    await screen.findByText('最多回合是 1–256 之间的整数。');
    const calls = onCheck.mock.calls.length;
    fireEvent.change(screen.getByLabelText('最多回合'), { target: { value: '12' } });
    await screen.findByText('按现在的成员和限制排不出这个流程。', undefined, { timeout: 2000 });
    expect(onCheck.mock.calls.length).toBe(calls + 1);
    expect((screen.getByRole('button', { name: '用于这个房间' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('ignores a check that answers after the draft changed', async () => {
    const first = deferred<WorkflowCheck>(); let calls = 0;
    open(() => ++calls === 1 ? first.promise : Promise.resolve({ ok: true, summary: '新的结果' }));
    await waitFor(() => expect(calls).toBe(1), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: /^深度辩论/u }));
    await act(async () => first.resolve({ ok: true, summary: '过期的结果' }));
    await screen.findByText('已核对：新的结果', undefined, { timeout: 2000 });
    expect(screen.queryByText('已核对：过期的结果')).toBeNull();
  });
});

describe('D116 per-room storage', () => {
  it('round-trips a draft, forgets it, and reports a damaged entry', () => {
    const draft = createWorkflowDraft('deep-debate', members);
    expect(writeRoomWorkflow('r1', draft)).toBe(true);
    expect(readRoomWorkflow('r1')).toEqual({ draft, damaged: false });
    expect(readRoomWorkflow('r2')).toEqual({ damaged: false });
    writeRoomWorkflow('r1', null); expect(readRoomWorkflow('r1')).toEqual({ damaged: false });
    localStorage.setItem('roundtable.workflow.r1', JSON.stringify({ version: 1, draft: { ...draft, template: 'something-else' } }));
    expect(readRoomWorkflow('r1')).toEqual({ damaged: true });
  });
});

describe('workflow progress', () => {
  const progress = (status: string, nextStep?: { kind: string; agentId: string }, completedTurns = 0) => workflowProgressForFeature({
    status, execution: { task: '目标', membersSnapshot: [{ agentId: 'b', displayName: '审查者' }] },
    workflow: { completedTurns, totalTurns: 5, elapsedMs: 0, currentStage: 's1', nextStep, stages: [{ id: 's1', kind: 'draft', status: 'running' }] },
  } as unknown as RunSnapshot)!;
  it('does not claim the plan is over while a Turn is being generated', () => {
    expect(progress('running').nextStep).toBe('当前发言结束后按计划继续');
    expect(progress('paused', { kind: 'review', agentId: 'b' }, 1).nextStep).toBe('审查 · 审查者');
    expect(progress('completed', undefined, 5).nextStep).toBe('没有待执行步骤');
  });
});
