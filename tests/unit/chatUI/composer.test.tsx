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
      '起草者点名后排在下一回合发言', '审查者不在当前阶段，按讨论方式现在不能点名', '综合者不在当前阶段，按讨论方式现在不能点名']);
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
