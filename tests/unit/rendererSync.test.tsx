import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  return { rooms, settings: { confirmTarget: vi.fn(),
    createProvider: vi.fn(), updateProvider: vi.fn(), getProviderConfiguration: vi.fn(),
    listProviderSummaries: vi.fn().mockResolvedValue([]), deleteProvider: vi.fn(), setKey: vi.fn(), deleteKey: vi.fn(),
    getProviderKeyState: vi.fn(), getKeyStorageStatus: vi.fn(), listModels: vi.fn(), testConnection: vi.fn(),
  } };
}

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
      run: { subscribe, start, getSnapshot: vi.fn().mockImplementation(async (id) => snapshot(id)),
        onEvent: vi.fn((handler) => { listener = handler; return unsubscribe; }),
        pause: vi.fn(), stop: vi.fn(), step: vi.fn(), resumeRun: vi.fn(), retryTurn: vi.fn(), continueMessage: vi.fn(), recoverInterruptedRun: vi.fn(),
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
    await waitFor(() => expect(screen.getByText('36')).toBeTruthy());
    fireEvent.click(screen.getByText('开始协作'));
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
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    act(() => listener(delta('gap', 4, '缺口后的尾部')));
    await waitFor(() => expect(screen.getByText('完整恢复文本')).toBeTruthy());
    expect(screen.queryByText('缺口后的尾部')).toBeNull();
  });

  it('consumes snapshot_required once when the authoritative cursor has not advanced', async () => {
    localStorage.setItem('roundtable.runId', 'resync');
    const unchanged = { snapshot: snapshot('resync', 4, '保留文本'), events: [], nextCursor: 4, resyncRequired: false };
    subscribe.mockResolvedValueOnce(unchanged).mockResolvedValueOnce(unchanged).mockRejectedValue(new Error('Repeated resynchronization'));
    render(<App />);
    await waitFor(() => expect(screen.getByText('4')).toBeTruthy());
    act(() => listener({ version: 1, runId: 'resync', sequence: 5, type: 'snapshot_required', payload: { reason: 'invalid_event' }, timestamp: new Date().toISOString() }));
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    expect(screen.getByText('保留文本')).toBeTruthy();
  });

  it('starts only once while the start command is pending and releases its listener', async () => {
    start.mockReturnValue(new Promise(() => {}));
    const view = render(<App />);
    await waitFor(() => expect((screen.getByText('开始协作') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('开始协作'));
    fireEvent.click(screen.getByText('开始协作'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('blocks Play and new rooms until the restored run snapshot arrives', async () => {
    localStorage.setItem('roundtable.runId', 'restoring');
    subscribe.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect((screen.getByText('开始协作') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('房间与成员') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('开始协作'));
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
    await waitFor(() => expect(screen.getAllByText('已完成')).toHaveLength(2));
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
      run: { subscribe, getSnapshot: vi.fn(), start: vi.fn(), onEvent: vi.fn(handler => { events.add(handler); return () => { events.delete(handler); }; }), pause: vi.fn(), stop: vi.fn(), step: vi.fn(), resumeRun: vi.fn(), retryTurn: vi.fn(), continueMessage: vi.fn(), recoverInterruptedRun: vi.fn() },
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
    fireEvent.change(screen.getByLabelText('任务目标'), { target: { value: '这是另一份草稿' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('数据库中的真实目标');
    expect(screen.getAllByText('数据库中的真实目标')).toHaveLength(2);
  });

  it('locks repeated room creation and presents its captured title after success', async () => {
    setup();
    vi.mocked(window.roundtable.rooms.listRooms).mockResolvedValue([]);
    let finish!: (value: ReturnType<typeof room>) => void;
    vi.mocked(window.roundtable.rooms.createRoom).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<App />);
    fireEvent.click(screen.getByText('房间与成员'));
    fireEvent.click(await screen.findByRole('button', { name: '新建房间' }));
    fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '创建目标' } });
    fireEvent.click(screen.getByRole('button', { name: '保存房间' }));
    fireEvent.click(screen.getByRole('button', { name: '正在保存…' }));
    expect(window.roundtable.rooms.createRoom).toHaveBeenCalledTimes(1);
    expect(window.roundtable.rooms.createRoom).toHaveBeenCalledWith({ name: '创建目标', objective: '' });
    expect((screen.getByText('开始协作') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(room('created', '创建目标')));
    expect(screen.getByRole('heading', { name: '创建目标' })).toBeTruthy();
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
    expect(screen.getByText(status === 'interrupted' ? '已中断' : '运行失败')).toBeTruthy();
    for (const name of ['暂停', '继续', '下一步', '停止']) expect((screen.getByText(name) as HTMLButtonElement).disabled).toBe(true);
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
    expect((screen.getByText('开始协作') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('重试同步'));
    await screen.findByText('恢复文本');
    expect(window.roundtable.run.start).not.toHaveBeenCalled();
  });
});
