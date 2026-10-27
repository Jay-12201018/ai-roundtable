import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostComposer, TaskComposer, type RunControls, type TaskSettings } from '../../../src/renderer/features/composer/Composer';
import { useHostCommands } from '../../../src/renderer/features/host';
import type { HostApiContract } from '../../../src/shared/contracts/app';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { time } from '../rendererSubscriptions/fixtures';
import { compileWorkflow } from '../../../src/main/workflow';
import { config, members, roomId } from '../workflows/fixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settings = (overrides: Partial<TaskSettings> = {}): TaskSettings => ({
  budgetText: '1', setBudgetText: vi.fn(), budgetValid: true, outputLimitText: '4096', setOutputLimitText: vi.fn(), outputLimitValid: true,
  stepMode: false, setStepMode: vi.fn(), workflowLabel: '按顺序轮流 · 3 回合', ...overrides,
});
function Task({ onStart, canStart = true }: { onStart: () => void; canStart?: boolean }) {
  const [draft, setDraft] = useState('');
  return <TaskComposer draft={draft} setDraft={setDraft} canStart={canStart} starting={false} onStart={onStart} settings={settings()} />;
}
const member = (agentId: string, displayName: string, displayOrder: number) => ({ agentId, displayName, roleTemplateId: '角色', systemPrompt: '', providerId: null, modelId: 'mock', displayOrder });
const paused = (overrides: Partial<RunSnapshot> = {}): RunSnapshot => ({
  runId: 'run', roomId: 'room', status: 'paused', sequence: 3, workflowSnapshot: {}, updatedAt: time, turns: [], messages: [],
  execution: { task: '任务', membersSnapshot: [member('a', '起草者', 0), member('b', '审查者', 1), member('c', '综合者', 2)], nextTurnIndex: 0, elapsedExecutionMs: 1, mode: 'step', maxTurns: 6,
    maxDurationMs: 300000, outputTokenLimit: 1024, currentTurnId: null, currentAgentId: null, startedAt: time, finishedAt: null, createdAt: time, updatedAt: time },
  host: { instructions: [], actions: [] }, ...overrides,
});
const controls = (status: RunSnapshot['status'], run = vi.fn()): RunControls => ({ status, inFlight: status !== 'paused', inFlightCost: '¥0.0386', speaker: '起草者',
  pause: { enabled: status === 'running', run }, resume: { enabled: status === 'paused', run }, step: { enabled: status === 'paused', run }, stop: { enabled: true, run } });
function Host({ snapshot, api, run }: { snapshot: RunSnapshot; api: HostApiContract; run?: RunControls }) {
  const commands = useHostCommands(api, snapshot.runId, () => {});
  return <HostComposer snapshot={snapshot} commands={commands} controls={run ?? controls(snapshot.status)} instructionsWritable />;
}
const hostApi = () => ({ command: vi.fn(async (input: { runId: string; kind: string }) => ({ runId: input.runId, actionId: 'x', kind: input.kind, duplicate: false })) }) as unknown as HostApiContract & { command: ReturnType<typeof vi.fn> };

describe('goal box: Enter adds a line, ⌘/Ctrl+Enter starts, an IME Enter only confirms', () => {
  it('starts only on the shortcut and never while composing', () => {
    const onStart = vi.fn();
    render(<Task onStart={onStart} />);
    const box = screen.getByLabelText('讨论目标');
    fireEvent.change(box, { target: { value: '目标' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('does not start from the shortcut when starting is not allowed', () => {
    const onStart = vi.fn();
    render(<Task onStart={onStart} canStart={false} />);
    fireEvent.keyDown(screen.getByLabelText('讨论目标'), { key: 'Enter', metaKey: true });
    expect(onStart).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps an invalid budget visible with its reason, beside a disabled start', () => {
    render(<TaskComposer draft="x" setDraft={() => {}} canStart={false} starting={false} onStart={() => {}} settings={settings({ budgetText: '0', budgetValid: false })} />);
    expect(screen.getByRole('group', { name: '更多设置' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('请输入 0.000001 到 1000 之间的金额，最多 6 位小数。');
    expect(screen.getByRole('button', { name: /预算有误/u })).toBeTruthy();
  });
});

describe('interjection box: Enter sends, Shift+Enter adds a line, an IME Enter only confirms', () => {
  it('sends once on a plain Enter and never on Shift+Enter or during composition', async () => {
    const api = hostApi();
    render(<Host snapshot={paused()} api={api} />);
    const box = screen.getByLabelText('主持人插话');
    fireEvent.change(box, { target: { value: '请看成本' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command.mock.calls[0][0]).toMatchObject({ kind: 'interject', content: '请看成本', runId: 'run' });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
  });

  it('opens the @ menu, moves with the arrow keys, picks with Enter, skips members that cannot be named, and closes with Esc', async () => {
    const api = hostApi();
    // A frozen 审查修订链 plan at its first step: only 起草者 (stage 起草) may be named now.
    const plan = compileWorkflow(config('review-revision'), roomId, members.map(item => ({ ...item, modelId: 'mock' })));
    render(<Host snapshot={paused({ workflowSnapshot: plan as unknown as RunSnapshot['workflowSnapshot'] })} api={api} />);
    const box = screen.getByLabelText('主持人插话') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@' } });
    const menu = screen.getByRole('listbox', { name: '点名下一位' });
    expect(within(menu).getAllByRole('option').map(option => option.querySelector('.grow')!.textContent)).toEqual([
      '起草者按计划就是下一位：只发插话，不多插一轮', '审查者不在当前阶段，按讨论方式现在不能点名', '综合者不在当前阶段，按讨论方式现在不能点名']);
    expect(within(menu).getAllByRole('option')[1].getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(within(menu).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@起草者 ');
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(box, { target: { value: '@起草者 @综' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    // Enter with the menu closed sends; a member who cannot be named is refused before anything is sent.
    fireEvent.change(box, { target: { value: '@综合者 总结一下' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText(/综合者不在当前阶段/u);
    expect(api.command).not.toHaveBeenCalled();
    expect(box.value).toBe('@综合者 总结一下');
  });

  it('runs D4 from the box: override then interject, with a feedback line', async () => {
    const api = hostApi();
    render(<Host snapshot={paused()} api={api} />);
    const box = screen.getByLabelText('主持人插话');
    fireEvent.change(box, { target: { value: '@综合者 算一下骑手收入' } });
    fireEvent.click(screen.getByRole('button', { name: '发送插话' }));
    await screen.findByText(/已点名综合者并发送插话/u);
    expect(api.command.mock.calls.map(call => call[0].kind)).toEqual(['setOverride', 'interject']);
    expect(api.command.mock.calls[0][0]).toMatchObject({ agentId: 'c' });
    expect(api.command.mock.calls[0][0].clientRequestId).not.toBe(api.command.mock.calls[1][0].clientRequestId);
  });

  it('turns the text into a standing instruction', async () => {
    const api = hostApi();
    render(<Host snapshot={paused()} api={api} />);
    fireEvent.change(screen.getByLabelText('主持人插话'), { target: { value: '只用中文' } });
    fireEvent.click(screen.getByRole('button', { name: '设为持续指令' }));
    await screen.findByText(/已设为持续指令/u);
    expect(api.command.mock.calls[0][0]).toMatchObject({ kind: 'setInstruction', content: '只用中文' });
    expect(api.command.mock.calls[0][0]).not.toHaveProperty('instructionId');
  });
});

describe('D098 controls in the composer', () => {
  it('orders 停止 | 下一步 · 暂停/继续 and asks before stopping, focus on 不停止, Esc back to 停止', async () => {
    const run = vi.fn();
    const { rerender } = render(<Host snapshot={paused({ status: 'running' })} api={hostApi()} run={controls('running', run)} />);
    const bar = screen.getByRole('group', { name: '运行控制' });
    expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['停止', '下一步', '暂停']);
    const pause = within(bar).getByRole('button', { name: '暂停' });
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    const confirm = screen.getByRole('dialog', { name: '确认停止运行' });
    expect(confirm.textContent).toContain('起草者正在发言');
    expect(confirm.textContent).toContain('按预留上限 ¥0.0386 计入');
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: '不停止' }));
    // The confirmation is a layer above the button; 暂停 is the same node and still usable.
    expect(within(bar).getByRole('button', { name: '暂停' })).toBe(pause);
    expect((pause as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '确认停止运行' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '停止' }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    fireEvent.click(screen.getByRole('button', { name: '停止讨论' }));
    expect(run).toHaveBeenCalledTimes(1);
    rerender(<Host snapshot={paused()} api={hostApi()} run={controls('paused', run)} />);
    expect(within(screen.getByRole('group', { name: '运行控制' })).getAllByRole('button').map(button => button.textContent)).toEqual(['停止', '下一步', '继续']);
    await act(async () => {});
  });
});

describe('D111 continuing a finished discussion from the same box', () => {
  const finished = (overrides: Partial<RunSnapshot> = {}) => paused({ status: 'completed', ...overrides });
  const runApi = (cost: Record<string, unknown> = { kind: 'priced', maxMicro: 30000, firstMicro: 9000, remainingMicro: 900000 }) => ({
    previewContinuation: vi.fn(async (input: { runId: string; agentId?: string }) => ({ runId: input.runId, available: true, agentIds: input.agentId ? [input.agentId] : ['a', 'b', 'c'], cost })),
    continueDiscussion: vi.fn(async (input: { runId: string; agentId?: string }) => ({ runId: input.runId, actionId: 'act', messageId: 'msg', agentIds: input.agentId ? [input.agentId] : ['a', 'b', 'c'], duplicate: false })),
  });
  function Continue({ snapshot, run, onApplied = () => {} }: { snapshot: RunSnapshot; run: ReturnType<typeof runApi>; onApplied?: () => void }) {
    const commands = useHostCommands(hostApi(), snapshot.runId, () => {});
    return <HostComposer snapshot={snapshot} commands={commands} instructionsWritable continueApi={run as never} onContinued={onApplied} settledSlot={<button type="button">新讨论</button>} />;
  }

  it('says who will answer and the most it may cost before sending, then continues the same Run', async () => {
    const run = runApi();
    const applied = vi.fn();
    render(<Continue snapshot={finished()} run={run} onApplied={applied} />);
    const box = screen.getByLabelText('继续讨论') as HTMLTextAreaElement;
    expect(box.placeholder).toContain('所有成员按顺序各回应一次');
    await waitFor(() => expect(screen.getByRole('status', { name: '继续后谁回应' }).textContent).toContain('起草者 → 审查者 → 综合者 各回应一次 · 单次最多约 ¥0.0090，整轮最多 ¥0.0300（按上限预留，实际按用量结算）'));
    fireEvent.change(box, { target: { value: '@综合者 请总结' } });
    await waitFor(() => expect(run.previewContinuation).toHaveBeenLastCalledWith({ runId: 'run', content: '@综合者 请总结', agentId: 'c' }));
    await waitFor(() => expect(screen.getByRole('status', { name: '继续后谁回应' }).textContent).toContain('只由综合者回应一次 · 最多 ¥0.0300（按上限预留，实际按用量结算）'));
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(run.continueDiscussion).toHaveBeenCalledTimes(1));
    expect(run.continueDiscussion.mock.calls[0][0]).toMatchObject({ runId: 'run', content: '@综合者 请总结', agentId: 'c' });
    await waitFor(() => expect(box.value).toBe(''));
    expect(applied).toHaveBeenCalled();
    expect(screen.getByText(/已在这场讨论里继续：综合者会回应你这段话/)).toBeTruthy();
    // A new discussion stays an explicit button beside the box.
    expect(screen.getByRole('button', { name: '新讨论' })).toBeTruthy();
  });

  it('refuses two names at once and keeps the text', async () => {
    const run = runApi({ kind: 'free' });
    render(<Continue snapshot={finished()} run={run} />);
    const box = screen.getByLabelText('继续讨论') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@起草者 @审查者 一起看看' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/一次只能让一位成员回应/)).toBeTruthy();
    expect(run.continueDiscussion).not.toHaveBeenCalled();
    expect(box.value).toBe('@起草者 @审查者 一起看看');
  });

  it('points to the budget before sending when the first answer cannot fit', async () => {
    const run = runApi();
    run.previewContinuation.mockResolvedValue({ runId: 'run', available: false, reason: 'budget_insufficient', agentIds: ['a', 'b', 'c'],
      cost: { kind: 'priced', maxMicro: 30000, firstMicro: 9000, remainingMicro: 2000 } } as never);
    render(<Continue snapshot={finished()} run={run} />);
    const strip = await screen.findByText(/剩余预算 ¥0.0020 不够第一次发言/);
    expect(strip).toBeTruthy();
    fireEvent.change(screen.getByLabelText('继续讨论'), { target: { value: '继续' } });
    expect((screen.getByRole('button', { name: '发送并继续讨论' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
