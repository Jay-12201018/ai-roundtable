import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostPanel, HostTimeline, useHostCommands } from '../../../src/renderer/features/host';
import { HostTextArea } from '../../../src/renderer/features/host/HostTextArea';
import { nextSpeaker, overrideCandidates, timelineSlots } from '../../../src/renderer/features/host/model';
import { compileWorkflow } from '../../../src/main/workflow';
import type { HostApiContract } from '../../../src/shared/contracts/app';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { config, members, roomId } from '../workflows/fixtures';
import { time } from '../rendererSubscriptions/fixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const member = (agentId: string, displayName: string, displayOrder: number) => ({ agentId, displayName, roleTemplateId: 'assistant', systemPrompt: '', providerId: null, modelId: 'mock', displayOrder });
const attempt = (requestId: string, turnId: string, messageId: string, attemptIndex: number, status: 'completed' | 'failed' = 'completed') =>
  ({ requestId, runId: 'run', turnId, messageId, attemptIndex, status, createdAt: time, startedAt: time, finishedAt: time, updatedAt: time });
function pausedSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: 'run', roomId, status: 'paused', sequence: 9, workflowSnapshot: {}, updatedAt: time,
    turns: [
      { turnId: 't1', runId: 'run', agentId: 'a', turnIndex: 0, status: 'completed', requestId: 'r2', messageId: 'm1b', outputText: '新开场' },
      { turnId: 't2', runId: 'run', agentId: 'b', turnIndex: 1, status: 'completed', requestId: 'r3', messageId: 'm2', outputText: '回应' },
    ],
    messages: [
      { id: 'm1', senderName: '成员 a', content: '旧开场', status: 'completed' },
      { id: 'h1', senderName: '主持人', content: '请关注成本', status: 'completed' },
      { id: 'm2', senderName: '成员 b', content: '回应', status: 'completed' },
      { id: 'm1b', senderName: '成员 a', content: '新开场', status: 'completed' },
    ],
    attempts: [attempt('r1', 't1', 'm1', 0), attempt('r3', 't2', 'm2', 0), attempt('r2', 't1', 'm1b', 1)],
    versions: [
      { messageId: 'm1', slotId: 't1', turnId: 't1', author: 'agent', versionNumber: 1, origin: 'original', active: false, requestId: 'r1', affectedBy: [] },
      { messageId: 'h1', slotId: 'h1', author: 'host', versionNumber: 1, origin: 'original', active: true, affectedBy: [] },
      { messageId: 'm2', slotId: 't2', turnId: 't2', author: 'agent', versionNumber: 1, origin: 'original', active: true, requestId: 'r3', affectedBy: ['m1'] },
      { messageId: 'm1b', slotId: 't1', turnId: 't1', author: 'agent', versionNumber: 2, origin: 'regenerate', active: true, requestId: 'r2', parentMessageId: 'm1', affectedBy: [] },
    ],
    execution: { task: '任务', membersSnapshot: [member('a', '成员 a', 0), member('b', '成员 b', 1), member('c', '成员 c', 2)], nextTurnIndex: 2, elapsedExecutionMs: 1, mode: 'step', maxTurns: 6, maxDurationMs: 300000, outputTokenLimit: 1024, currentTurnId: null, currentAgentId: null, startedAt: time, finishedAt: null, createdAt: time, updatedAt: time },
    host: { instructions: [{ instructionId: 'i1', revisionId: 'v2', revision: 2, content: '只用中文', status: 'active', updatedAt: time }], actions: [] },
    ...overrides,
  };
}
function Harness({ snapshot, api, onApplied = () => {} }: { snapshot: RunSnapshot; api: HostApiContract; onApplied?: () => void }) {
  const commands = useHostCommands(api, snapshot.runId, onApplied);
  return <><HostTimeline snapshot={snapshot} commands={commands} /><HostPanel snapshot={snapshot} commands={commands} /></>;
}
const hostApi = (implementation?: HostApiContract['command']) => ({ command: vi.fn(implementation ?? (async input => ({ runId: input.runId, actionId: 'action', kind: input.kind, duplicate: false }))) });

describe('R12 host projection model', () => {
  it('groups versions by slot in original position and projects the next speaker', () => {
    const snapshot = pausedSnapshot();
    expect(timelineSlots(snapshot)!.map(slot => [slot.slotId, slot.active.messageId, slot.versions.length])).toEqual([['t1', 'm1b', 2], ['h1', 'h1', 1], ['t2', 'm2', 1]]);
    expect(nextSpeaker(snapshot)).toEqual({ agentId: 'c', name: '成员 c', source: 'plan' });
    const overridden = pausedSnapshot({ host: { instructions: [], actions: [], override: { actionId: 'o', agentId: 'a', status: 'pending', createdAt: time } } });
    expect(nextSpeaker(overridden)).toEqual({ agentId: 'a', name: '成员 a', source: 'override' });
    expect(timelineSlots({ ...snapshot, versions: undefined })).toBeNull();
  });

  it('offers only current-stage members during a workflow', () => {
    const plan = compileWorkflow(config('review-revision'), roomId, members.map(item => ({ ...item, modelId: 'mock' })));
    const snapshot = pausedSnapshot({ workflowSnapshot: plan as unknown as RunSnapshot['workflowSnapshot'], turns: pausedSnapshot().turns.slice(0, 1) });
    expect(overrideCandidates(snapshot).map(item => item.agentId)).toEqual(['b']);
  });
});

describe('R12 host IME-safe text input', () => {
  it('sends on Enter, keeps Shift+Enter and never sends while composing', () => {
    const onSubmit = vi.fn();
    render(<HostTextArea aria-label="输入" onSubmit={onSubmit} defaultValue="" />);
    const box = screen.getByLabelText('输入');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('R12 host UI', () => {
  it('shows the effective version, version navigation, affected marks and host attribution', () => {
    render(<Harness snapshot={pausedSnapshot()} api={hostApi()} />);
    expect(screen.getByText('新开场')).toBeTruthy();
    expect(screen.queryByText('旧开场')).toBeNull();
    expect(screen.getByText('版本 2/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看上一个版本' }));
    expect(screen.getByText('旧开场')).toBeTruthy();
    expect(screen.getByText(/未生效的历史版本/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '设为当前版本' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('受影响');
    expect(screen.getByText('主持人插话')).toBeTruthy();
    expect(screen.getByText(/下一位：成员 c（按计划）/)).toBeTruthy();
    expect(screen.getByText('只用中文')).toBeTruthy();
  });

  it('sends one Override per click burst with a fresh clientRequestId and refreshes afterwards', async () => {
    let finish!: () => void;
    const api = hostApi(input => new Promise(resolve => { finish = () => resolve({ runId: input.runId, actionId: 'o', kind: input.kind, duplicate: false }); }));
    const onApplied = vi.fn();
    render(<Harness snapshot={pausedSnapshot()} api={api} onApplied={onApplied} />);
    fireEvent.change(screen.getByLabelText('点名成员'), { target: { value: 'c' } });
    const button = screen.getByRole('button', { name: '点名下一位' });
    fireEvent.click(button); fireEvent.click(button);
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command.mock.calls[0][0]).toMatchObject({ runId: 'run', kind: 'setOverride', agentId: 'c', clientRequestId: expect.any(String) });
    expect(screen.getByText('主持人操作已发送，等待主进程确认')).toBeTruthy();
    await act(async () => { finish(); });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByText('已点名，将在当前回合结束后发言。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '点名下一位' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2));
    expect(api.command.mock.calls[1][0].clientRequestId).not.toBe(api.command.mock.calls[0][0].clientRequestId);
  });

  it('shows Main refusals as structured Chinese feedback without changing the projection', async () => {
    const api = hostApi(async () => { throw { code: 'invalid_state', message: 'Operation is not allowed in the current state', retryable: false }; });
    render(<Harness snapshot={pausedSnapshot()} api={api} />);
    fireEvent.click(screen.getAllByRole('button', { name: '重新生成' })[0]);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('当前状态不允许此操作'));
    expect(screen.getByText('新开场')).toBeTruthy();
  });

  it('edits a message as a new version, and interjects and manages instructions with the IME-safe composer', async () => {
    const api = hostApi();
    render(<Harness snapshot={pausedSnapshot()} api={api} />);
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0]);
    const editor = screen.getByLabelText('修改消息内容');
    fireEvent.change(editor, { target: { value: '主持人修订\n第二行' } });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'editMessage', messageId: 'm1b', content: '主持人修订\n第二行' })));
    fireEvent.change(screen.getByLabelText('主持人插话'), { target: { value: '补充一点' } });
    fireEvent.keyDown(screen.getByLabelText('主持人插话'), { key: 'Enter' });
    await waitFor(() => expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'interject', content: '补充一点' })));
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    await waitFor(() => expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'clearInstruction', instructionId: 'i1' })));
    fireEvent.change(screen.getByLabelText('新增持续指令'), { target: { value: '给出编号' } });
    fireEvent.click(screen.getByRole('button', { name: '添加持续指令' }));
    await waitFor(() => expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'setInstruction', content: '给出编号' })));
    expect(api.command.mock.calls.at(-1)![0]).not.toHaveProperty('instructionId');
  });

  it('disables version actions while a request is in flight and offers abort for a regeneration', () => {
    const base = pausedSnapshot();
    const running = pausedSnapshot({
      messages: [...base.messages, { id: 'm1c', senderName: '成员 a', content: '生成中', status: 'streaming' }],
      attempts: [...base.attempts!, { ...attempt('r4', 't1', 'm1c', 2), status: 'running' }],
      versions: [...base.versions!, { messageId: 'm1c', slotId: 't1', turnId: 't1', author: 'agent', versionNumber: 3, origin: 'regenerate', active: false, requestId: 'r4', affectedBy: [] }],
      host: { instructions: [], actions: [], generation: { requestId: 'r4', messageId: 'm1c', turnId: 't1' } },
    });
    render(<Harness snapshot={running} api={hostApi()} />);
    expect(screen.getByText(/正在重新生成版本 3/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull();
    expect(screen.getByRole('button', { name: '中止重新生成' })).toBeTruthy();
  });
});
