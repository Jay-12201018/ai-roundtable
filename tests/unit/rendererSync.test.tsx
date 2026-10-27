import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { props as roomProps, room } from './rendererRooms/fixtures';
import type { RunEvent, RunSnapshot, RunSubscription } from '../../src/shared/types/run';

function snapshot(runId: string, sequence = 0, content = ''): RunSnapshot {
  return {
    runId, roomId: 'room', status: 'running', sequence, workflowSnapshot: {},
    turns: [{ turnId: `${runId}-turn`, runId, agentId: 'agent', requestId: `${runId}-request`, messageId: `${runId}-message`, status: 'running', outputText: content }], updatedAt: new Date().toISOString(),
    messages: [{ id: `${runId}-message`, senderName: '起草者', content, status: 'streaming' }],
  };
}

function delta(runId: string, sequence: number, text: string): RunEvent {
  return { version: 1, runId, turnId: `${runId}-turn`, requestId: `${runId}-request`, sequence, type: 'text_delta', timestamp: new Date().toISOString(), payload: { turnId: `${runId}-turn`, messageId: `${runId}-message`, senderName: '起草者', text } };
}

function configurationApis() {
  const rooms = roomProps().api;
  vi.mocked(rooms.listRooms).mockResolvedValue([room('room', '现有房间')]);
  return { rooms, host: { command: vi.fn() }, summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn() }, usage: { getReport: vi.fn(), writeOff: vi.fn(), exportCsv: vi.fn() }, settings: { confirmTarget: vi.fn(),
    createProvider: vi.fn(), updateProvider: vi.fn(), getProviderConfiguration: vi.fn(),
    listProviderSummaries: vi.fn().mockResolvedValue([]), deleteProvider: vi.fn(), setKey: vi.fn(), deleteKey: vi.fn(),
    getProviderKeyState: vi.fn(), getKeyStorageStatus: vi.fn(), listModels: vi.fn(), testConnection: vi.fn(),
  } };
}

/** R16: the event sequence is in 本场信息 › 运行详情 (a drawer at this width), not on the page itself. */
async function eventSequence(value: string) {
  const toggle = await screen.findByRole('button', { name: '本场信息' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  await waitFor(() => expect(within(screen.getByRole('dialog', { name: '本场信息' })).getByText(value)).toBeTruthy());
  fireEvent.keyDown(screen.getByRole('dialog', { name: '本场信息' }), { key: 'Escape' });
}
const runStatus = () => screen.getByRole('status', { name: '运行状态' }).textContent;

describe('Renderer run synchronization', () => {
  let listener: (event: RunEvent) => void;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn();
  const start = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    subscribe.mockImplementation(async (id: string): Promise<RunSubscription> => ({ snapshot: snapshot(id), events: [], nextCursor: 0, resyncRequired: false }));
    start.mockResolvedValue(snapshot('new', 2));
    window.roundtable = {
      ...configurationApis(),
      room: { createDemo: vi.fn().mockResolvedValue({ roomId: 'room' }), getMessages: vi.fn().mockResolvedValue([]) },
      run: { previewWorkflow: vi.fn(async () => { throw new Error('Workflow preview not configured in fixture'); }), subscribe, start, getSnapshot: vi.fn().mockImplementation(async (id) => snapshot(id)),
        onEvent: vi.fn((handler) => { listener = handler; return unsubscribe; }),
        pause: vi.fn(), stop: vi.fn(), step: vi.fn(), resumeRun: vi.fn(), retryTurn: vi.fn(), continueMessage: vi.fn(), recoverInterruptedRun: vi.fn(),
        addBudget: vi.fn(), resumeAfterBudget: vi.fn(), previewContinuation: vi.fn(), continueDiscussion: vi.fn(),
      },
    };
  });

  afterEach(cleanup);

  it('restores persisted text once without replaying its deltas or calling the provider', async () => {
    localStorage.setItem('roundtable.runId', 'old');
    const saved = snapshot('old', 4, '已保存的文本');
    subscribe.mockResolvedValue({ snapshot: saved, events: [delta('old', 3, '已保存的文本')], nextCursor: 4, resyncRequired: false });
    window.roundtable.room.getMessages = vi.fn().mockResolvedValue(saved.messages);
    render(<App />);
    await waitFor(() => expect(screen.getByText('已保存的文本')).toBeTruthy());
    expect(start).not.toHaveBeenCalled();
  });

  it('accepts the new run cursor and rejects late events from the previous run', async () => {
    localStorage.setItem('roundtable.runId', 'old');
    subscribe.mockImplementation(async (id: string) => ({ snapshot: { ...snapshot(id, id === 'old' ? 36 : 2), status: id === 'old' ? 'completed' : 'running' }, events: [], nextCursor: id === 'old' ? 36 : 2, resyncRequired: false }));
    render(<App />);
    await eventSequence('36');
    fireEvent.click(screen.getByText('开始讨论'));
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith('new', expect.any(Number)));
    act(() => { listener(delta('old', 37, '旧请求内容')); listener(delta('new', 3, '新请求内容')); });
    await waitFor(() => expect(screen.getByText('新请求内容')).toBeTruthy());
    expect(screen.queryByText('旧请求内容')).toBeNull();
  });

  it('keeps events arriving between snapshot capture and subscription response', async () => {
    localStorage.setItem('roundtable.runId', 'race');
    let finish!: (subscription: RunSubscription) => void;
    subscribe.mockReturnValue(new Promise<RunSubscription>((resolve) => { finish = resolve; }));
    render(<App />);
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    act(() => listener(delta('race', 3, '实时内容')));
    await act(async () => finish({ snapshot: snapshot('race', 2), events: [], nextCursor: 2, resyncRequired: false }));
    await waitFor(() => expect(screen.getByText('实时内容')).toBeTruthy());
  });

  it('resynchronizes on a sequence gap instead of appending incomplete text', async () => {
    localStorage.setItem('roundtable.runId', 'gap');
    subscribe.mockResolvedValueOnce({ snapshot: snapshot('gap', 2), events: [], nextCursor: 2, resyncRequired: false });
    subscribe.mockResolvedValue({ snapshot: snapshot('gap', 4, '完整恢复文本'), events: [], nextCursor: 4, resyncRequired: true });
    render(<App />);
    await eventSequence('2');
    act(() => listener(delta('gap', 4, '缺口后的尾部')));
    await waitFor(() => expect(screen.getByText('完整恢复文本')).toBeTruthy());
    expect(screen.queryByText('缺口后的尾部')).toBeNull();
  });

  it('consumes snapshot_required once when the authoritative cursor has not advanced', async () => {
    localStorage.setItem('roundtable.runId', 'resync');
    const unchanged = { snapshot: snapshot('resync', 4, '保留文本'), events: [], nextCursor: 4, resyncRequired: false };
    subscribe.mockResolvedValueOnce(unchanged).mockResolvedValueOnce(unchanged).mockRejectedValue(new Error('Repeated resynchronization'));
    render(<App />);
    await eventSequence('4');
    act(() => listener({ version: 1, runId: 'resync', sequence: 5, type: 'snapshot_required', payload: { reason: 'invalid_event' }, timestamp: new Date().toISOString() }));
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    expect(screen.getByText('保留文本')).toBeTruthy();
  });

  it('starts only once while the start command is pending and releases its listener', async () => {
    start.mockReturnValue(new Promise(() => {}));
    const view = render(<App />);
    await waitFor(() => expect((screen.getByText('开始讨论') as HTMLButtonElement).disabled).toBe(false));
    // Two clicks on the same button in one burst; the label changes to 正在开始… in place.
    const button = screen.getByText('开始讨论');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('blocks Play and new rooms until the restored run snapshot arrives', async () => {
    localStorage.setItem('roundtable.runId', 'restoring');
    subscribe.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect((screen.getByText('开始讨论') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '新建房间' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('开始讨论'));
    expect(start).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('displays workflow and message status in Simplified Chinese', async () => {
    localStorage.setItem('roundtable.runId', 'localized');
    const saved = snapshot('localized', 4, '定稿内容');
    saved.status = 'completed';
    saved.turns.forEach(turn => { turn.status = 'completed'; });
    saved.messages[0].status = 'completed';
    subscribe.mockResolvedValue({ snapshot: saved, events: [], nextCursor: 4, resyncRequired: false });
    render(<App />);
    await waitFor(() => expect(runStatus()).toContain('已完成'));
    expect(screen.getByText(/^讨论已完成 · 可以在下方继续这场讨论/)).toBeTruthy();
    // A finished message carries no status line; an unfinished one says so in Chinese.
    expect(screen.queryByText('completed')).toBeNull();
  });
});

describe('Renderer task identity and command feedback', () => {
  afterEach(cleanup);
  function setup(saved?: RunSnapshot) {
    localStorage.clear();
    if (saved) localStorage.setItem('roundtable.runId', saved.runId);
    const events = new Set<(event: RunEvent) => void>();
    const subscribe = vi.fn(async () => ({ snapshot: saved!, events: [], nextCursor: saved!.sequence, resyncRequired: false }));
    window.roundtable = {
      ...configurationApis(),
      room: { createDemo: vi.fn(), getMessages: vi.fn() },
      run: { previewWorkflow: vi.fn(async () => { throw new Error('Workflow preview not configured in fixture'); }), subscribe, getSnapshot: vi.fn(), start: vi.fn(), onEvent: vi.fn(handler => { events.add(handler); return () => { events.delete(handler); }; }), pause: vi.fn(), stop: vi.fn(), step: vi.fn(), resumeRun: vi.fn(), retryTurn: vi.fn(), continueMessage: vi.fn(), recoverInterruptedRun: vi.fn(), addBudget: vi.fn(), resumeAfterBudget: vi.fn(), previewContinuation: vi.fn(), continueDiscussion: vi.fn() },
    };
    return { subscribe, events };
  }
  it('does not change a durable task title when its editable draft changes', async () => {
    const saved = snapshot('history', 4, '历史消息');
    saved.status = 'completed';
    saved.turns.forEach(turn => { turn.status = 'completed'; });
    saved.execution = { task: '数据库中的真实目标', membersSnapshot: null, nextTurnIndex: 1, elapsedExecutionMs: 0, mode: 'automatic', maxTurns: 3, maxDurationMs: 1000, outputTokenLimit: 1000, currentTurnId: null, currentAgentId: null, startedAt: null, finishedAt: null, createdAt: saved.updatedAt, updatedAt: saved.updatedAt };
    setup(saved);
    render(<App />);
    await screen.findByText('历史消息');
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('讨论目标'), { target: { value: '这是另一份草稿' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('数据库中的真实目标');
    expect(screen.getAllByText('数据库中的真实目标')).toHaveLength(2);
  });

  it('locks repeated room creation and presents its captured title after success', async () => {
    setup();
    vi.mocked(window.roundtable.rooms.listRooms).mockResolvedValue([]);
    let finish!: (value: ReturnType<typeof room>) => void;
    vi.mocked(window.roundtable.rooms.createRoom).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: '新建房间' }))[0]);
    fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '创建目标' } });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    fireEvent.click(screen.getByRole('button', { name: '正在保存…' }));
    expect(window.roundtable.rooms.createRoom).toHaveBeenCalledTimes(1);
    expect(window.roundtable.rooms.createRoom).toHaveBeenCalledWith({ name: '创建目标', objective: '' });
    expect(window.roundtable.run.start).not.toHaveBeenCalled();
    vi.mocked(window.roundtable.rooms.listRooms).mockResolvedValue([room('created', '创建目标')]);
    await act(async () => finish(room('created', '创建目标')));
    // The new room opens on its page, with the three default members created.
    await screen.findAllByRole('heading', { name: '创建目标' });
    expect(vi.mocked(window.roundtable.rooms.createAgent).mock.calls.map(([input]) => input.displayName)).toEqual(['起草者', '审查者', '综合者']);
  });

  it.each(['interrupted', 'error'] as const)('preserves partial messages and disables unavailable controls for %s', async (status) => {
    const saved = snapshot('partial', 4, '必须保留的部分输出');
    saved.status = status;
    saved.turns.forEach(turn => { turn.status = status === 'interrupted' ? 'interrupted' : 'failed'; });
    saved.currentTurnId = undefined; saved.activeAgentId = undefined;
    saved.messages[0].status = status === 'interrupted' ? 'aborted' : 'failed';
    setup(saved);
    render(<App />);
    await screen.findByText('必须保留的部分输出');
    expect(runStatus()).toContain(status === 'interrupted' ? '已中断' : '运行失败');
    // D098: run controls exist only while a Run is live; a settled Run offers a new discussion in their place.
    expect(screen.queryByRole('group', { name: '运行控制' })).toBeNull();
    for (const name of ['暂停', '继续', '下一步', '停止']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(document.querySelector('.composer .controls .slot')!.textContent).toBe('新讨论');
    expect(window.roundtable.run.recoverInterruptedRun).not.toHaveBeenCalled();
  });

  it('releases the StrictMode test mount and the final listener without accumulating subscriptions', async () => {
    const { events } = setup(snapshot('strict', 4, 'StrictMode恢复'));
    const view = render(<StrictMode><App /></StrictMode>);
    await screen.findByText('StrictMode恢复');
    expect(window.roundtable.run.onEvent).toHaveBeenCalledTimes(2);
    expect(events.size).toBe(1);
    view.unmount();
    expect(events.size).toBe(0);
  });

  it('displays sync failure, blocks commands and lets the user retry only the snapshot', async () => {
    const { subscribe } = setup(snapshot('retry', 4, '恢复文本'));
    subscribe.mockRejectedValueOnce(new Error('/private/database'));
    render(<App />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).not.toContain('/private');
    expect((screen.getByText('开始讨论') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('重试同步'));
    await screen.findByText('恢复文本');
    expect(window.roundtable.run.start).not.toHaveBeenCalled();
  });
});
