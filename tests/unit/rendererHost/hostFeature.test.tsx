import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHostCommands, useSummaryCommands } from '../../../src/renderer/features/host';
import { DiscussionTimeline, type ProviderNames } from '../../../src/renderer/features/timeline';
import { RunPanel, type PanelTab } from '../../../src/renderer/features/runPanel/RunPanel';
import { HostComposer, interjectionBoxFor } from '../../../src/renderer/features/composer/Composer';
import { HostTextArea } from '../../../src/renderer/features/host/HostTextArea';
import { nextSpeaker, nextSpeakerText, overrideCandidates, timelineSlots } from '../../../src/renderer/features/host/model';
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
/** The R16 discussion screen without the shell: timeline, 本场信息 (one tab) and the interjection box. */
function Harness({ snapshot, api, onApplied = () => {}, tab = 'members', providers }: { snapshot: RunSnapshot; api: HostApiContract; onApplied?: () => void; tab?: PanelTab; providers?: ProviderNames }) {
  const commands = useHostCommands(api, snapshot.runId, onApplied);
  const summaries = useSummaryCommands(undefined, snapshot.runId, () => {});
  return <>
    <DiscussionTimeline snapshot={snapshot} commands={commands} summaries={summaries} providers={providers} onRegenerateSummary={() => {}} />
    <RunPanel snapshot={snapshot} commands={commands} tab={tab} onTab={() => {}} onClose={() => {}} syncLabel="已同步" />
    {interjectionBoxFor(snapshot, ['running', 'pausing', 'paused', 'cancelling'].includes(snapshot.status)) && <HostComposer snapshot={snapshot} commands={commands} instructionsWritable />}
  </>;
}
const hostApi = (implementation?: HostApiContract['command']) => ({ command: vi.fn(implementation ?? (async input => ({ runId: input.runId, actionId: 'action', kind: input.kind, duplicate: false }))) });

describe('R12 host projection model', () => {
  it('groups versions by slot in original position and projects the next speaker', () => {
    const snapshot = pausedSnapshot();
    expect(timelineSlots(snapshot)!.map(slot => [slot.slotId, slot.active.messageId, slot.versions.length])).toEqual([['t1', 'm1b', 2], ['h1', 'h1', 1], ['t2', 'm2', 1]]);
    expect(nextSpeaker(snapshot)).toEqual({ agentId: 'c', name: '成员 c', source: 'plan' });
    const overridden = pausedSnapshot({ host: { instructions: [], actions: [], override: { actionId: 'o', agentId: 'a', status: 'pending', createdAt: time } } });
    // D110: the named member is inserted, and the plan's next speaker follows.
    expect(nextSpeaker(overridden)).toEqual({ agentId: 'a', name: '成员 a', source: 'override', then: { agentId: 'c', name: '成员 c', source: 'plan' } });
    expect(timelineSlots({ ...snapshot, versions: undefined })).toBeNull();
  });

  it('D110/D111: says who follows an inserted Turn, and that a continued discussion ends after its answers', () => {
    const overridden = pausedSnapshot({ execution: { ...pausedSnapshot().execution!, maxTurns: 2 },
      host: { instructions: [], actions: [], override: { actionId: 'o', agentId: 'b', status: 'pending', createdAt: time } } });
    expect(nextSpeaker(overridden)).toEqual({ agentId: 'b', name: '成员 b', source: 'override', then: 'end' });
    expect(nextSpeakerText(nextSpeaker(overridden)!)).toEqual({ name: '成员 b', source: '主持人点名，插入一轮，不打断正在进行的发言', then: '之后讨论结束' });
    const base = pausedSnapshot();
    const continued = pausedSnapshot({ status: 'running', continuations: [{ actionId: 'k', messageId: 'h1', agentIds: ['c', 'a'], createdAt: time }],
      turns: [...base.turns, { turnId: 't3', runId: 'run', agentId: 'c', turnIndex: 2, status: 'completed', overrideActionId: 'k' }] });
    expect(nextSpeaker(continued)).toEqual({ agentId: 'a', name: '成员 a', source: 'continuation' });
    expect(nextSpeaker({ ...continued, turns: [...continued.turns, { turnId: 't4', runId: 'run', agentId: 'a', turnIndex: 3, status: 'running', overrideActionId: 'k' }] })).toBeUndefined();
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
    render(<Harness snapshot={pausedSnapshot()} api={hostApi()} tab="instructions" />);
    expect(screen.getByText('新开场')).toBeTruthy();
    expect(screen.queryByText('旧开场')).toBeNull();
    expect(screen.getByText('版本 2/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看上一个版本' }));
    expect(screen.getByText('旧开场')).toBeTruthy();
    expect(screen.getByText(/未生效的历史版本/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '设为当前版本' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('受影响 · 写这条时依据的「成员 a」的发言已被修改');
    expect(screen.getByText('主持人插话')).toBeTruthy();
    expect(screen.getByRole('status', { name: '下一位' }).textContent).toContain('下一位：成员 c（按计划）');
    expect(screen.getByText('只用中文')).toBeTruthy();
  });

  it('sends one Override per click burst with a fresh clientRequestId and refreshes afterwards', async () => {
    let finish!: () => void;
    const api = hostApi(input => new Promise(resolve => { finish = () => resolve({ runId: input.runId, actionId: 'o', kind: input.kind, duplicate: false }); }));
    const onApplied = vi.fn();
    render(<Harness snapshot={pausedSnapshot()} api={api} onApplied={onApplied} />);
    const button = screen.getByRole('button', { name: '点名 成员 c' });
    fireEvent.click(button); fireEvent.click(button);
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command.mock.calls[0][0]).toMatchObject({ runId: 'run', kind: 'setOverride', agentId: 'c', clientRequestId: expect.any(String) });
    expect(screen.getByText('正在发送，等待主进程确认…')).toBeTruthy();
    await act(async () => { finish(); });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByText('已点名成员 c，将在下一回合发言。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '点名 成员 c' }));
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
    render(<Harness snapshot={pausedSnapshot()} api={api} tab="instructions" />);
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0]);
    const editor = screen.getByLabelText('修改消息内容');
    expect(document.activeElement).toBe(editor);
    expect((screen.getByRole('button', { name: '保存为新版本' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(editor, { target: { value: '主持人修订\n第二行' } });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'editMessage', messageId: 'm1b', content: '主持人修订\n第二行' })));
    fireEvent.change(screen.getByLabelText('主持人插话'), { target: { value: '补充一点' } });
    fireEvent.keyDown(screen.getByLabelText('主持人插话'), { key: 'Enter' });
    await waitFor(() => expect(api.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'interject', content: '补充一点' })));
    fireEvent.click(screen.getAllByRole('button', { name: '修改' }).at(-1)!);
    expect(document.activeElement).toBe(screen.getByLabelText('修改持续指令'));
    expect((screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(document.querySelector('.instr')!).getByRole('button', { name: '取消' }));
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

  it('continues a completed Run in place instead of opening a new discussion, and labels an unfinished current version', () => {
    const base = pausedSnapshot();
    const failed = pausedSnapshot({ status: 'error', messages: base.messages.map(m => m.id === 'm2' ? { ...m, status: 'failed' as const } : m),
      turns: base.turns.map(t => t.turnId === 't2' ? { ...t, status: 'failed' as const } : t),
      versions: [...base.versions!.slice(0, 2), { ...base.versions![2], affectedBy: [] }, base.versions![3],
        { messageId: 'm2b', slotId: 't2', turnId: 't2', author: 'agent' as const, versionNumber: 2, origin: 'retry' as const, active: true, affectedBy: [] }].map(v => v.messageId === 'm2' ? { ...v, active: false } : v),
    });
    failed.messages.push({ id: 'm2b', senderName: '成员 b', content: '再次中断', status: 'failed' });
    const { unmount } = render(<Harness snapshot={failed} api={hostApi()} />);
    expect(screen.getByText(/重试 · 当前版本（未完成）/)).toBeTruthy();
    unmount();
    render(<Harness snapshot={pausedSnapshot({ status: 'completed' })} api={hostApi()} />);
    // D111: a finished Run is continued from the same box (App gives it the continuation API); a new discussion is
    // only the explicit 新讨论 button.
    expect(interjectionBoxFor(pausedSnapshot({ status: 'completed' }), false)).toBe(true);
    expect(interjectionBoxFor(failed, false)).toBe(true);
    expect(screen.getByText(/讨论已结束。可以在下方输入框里继续/)).toBeTruthy();
  });
});

describe('Provider names in member identity lines', () => {
  const providerId = '91f54a81-b95b-4fce-a9f7-7a5a4ecd21c3';
  const withProvider = (id: string | null, modelId = 'deepseek-flash') => pausedSnapshot({
    execution: { ...pausedSnapshot().execution!, membersSnapshot: pausedSnapshot().execution!.membersSnapshot!.map(m => ({ ...m, roleTemplateId: 'Drafter', providerId: id, modelId })) },
  });
  function TimelineOnly({ snapshot, providers }: { snapshot: RunSnapshot; providers?: ProviderNames }) {
    const commands = useHostCommands(hostApi(), snapshot.runId, () => {});
    const summaries = useSummaryCommands(undefined, snapshot.runId, () => {});
    return <DiscussionTimeline snapshot={snapshot} commands={commands} summaries={summaries} providers={providers} onRegenerateSummary={() => {}} />;
  }
  // R16: the identity line names the model; the service and model ID are one click away in 请求详情.
  const models = () => [...document.querySelectorAll('.msg-meta')].map(node => node.textContent);
  const details = () => { for (const button of screen.getAllByRole('button', { name: '请求详情' })) fireEvent.click(button); return screen.getAllByRole('region', { name: '请求详情' }).map(node => node.textContent); };

  it('shows the Provider name from the frozen snapshot id, never the UUID', () => {
    render(<TimelineOnly snapshot={withProvider(providerId)} providers={{ state: 'ready', names: new Map([[providerId, 'DeepSeek 直连']]), models: new Map([[`${providerId}:deepseek-flash`, 'DeepSeek Flash']]) }} />);
    expect(models().length).toBeGreaterThan(0);
    for (const line of models()) expect(line).toBe('DeepSeek Flash');
    for (const line of details()) expect(line).toBe('角色Drafter服务DeepSeek 直连模型 IDdeepseek-flash');
    expect(document.body.textContent).not.toContain(providerId);
  });

  it.each([
    ['ready', '服务已删除'],
    ['loading', '正在读取服务名称'],
    ['error', '服务名称暂时无法读取'],
  ] as const)('explains a Provider it cannot name (%s) instead of showing its id', (state, expected) => {
    render(<TimelineOnly snapshot={withProvider(providerId)} providers={{ state, names: new Map() }} />);
    for (const line of models()) expect(line).toBe('deepseek-flash');
    for (const line of details()) expect(line).toContain(`服务${expected}`);
    expect(document.body.textContent).not.toContain(providerId);
  });

  it('names the built-in Mock of legacy demo members', () => {
    render(<TimelineOnly snapshot={withProvider(null, 'mock')} providers={{ state: 'ready', names: new Map() }} />);
    for (const line of models()) expect(line).toBe('内置演示（Mock）');
    for (const line of details()) expect(line).toContain('服务内置 Mock（不联网、不计费）');
  });
});

describe('D102 truncated replies in the timeline', () => {
  const truncatedSnapshot = (status: RunSnapshot['status'] = 'paused') => {
    const snapshot = pausedSnapshot({ status });
    snapshot.attempts = snapshot.attempts!.map(attempt => attempt.messageId === 'm2' ? { ...attempt, finishReason: 'length' as const } : { ...attempt, finishReason: 'stop' as const });
    return snapshot;
  };
  const slotOf = (content: string) => screen.getByText(content).closest('article')!;
  const truncatedNote = (slot: Element) => [...slot.querySelectorAll('.note[role=note]')].find(note => note.textContent!.includes('单次上限'));

  it('marks the reply and continues it as a new version while the Run is idle', async () => {
    const api = hostApi();
    render(<Harness snapshot={truncatedSnapshot()} api={api} />);
    const slot = slotOf('回应');
    expect(truncatedNote(slot)!.querySelector('.note-body')!.textContent).toBe('写到单次上限停下了，内容可能不完整。续写会生成一个新版本，按新请求计费。');
    // The one next step, with what it may cost: a Mock member costs nothing.
    expect(truncatedNote(slot)!.querySelector('.note-cost')!.textContent).toBe('内置 Mock，不花钱');
    const button = within(slot).getByRole('button', { name: '续写' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', kind: 'regenerateMessage', messageId: 'm2', mode: 'continue' })));
    expect(within(slotOf('新开场')).queryByRole('button', { name: '续写' })).toBeNull();
    expect(truncatedNote(slotOf('新开场'))).toBeUndefined();
  });

  it('never preempts a running Run: the button waits and says why', () => {
    render(<Harness snapshot={truncatedSnapshot('running')} api={hostApi()} />);
    const slot = slotOf('回应');
    expect(truncatedNote(slot)!.querySelector('.note-body')!.textContent).toBe('写到单次上限停下了，内容可能不完整。续写会生成一个新版本，按新请求计费。运行暂停或结束后可以续写。');
    expect((within(slot).getByRole('button', { name: '续写' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
