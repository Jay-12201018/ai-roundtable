import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { RunEvent, RunSnapshot, RunSubscription } from '../../src/shared/types/run';

function snapshot(runId: string, sequence = 0, content = ''): RunSnapshot {
  return {
    runId, roomId: 'room', status: 'running', sequence, workflowSnapshot: {},
    turns: [], updatedAt: new Date().toISOString(),
    messages: content ? [{ id: `${runId}-message`, senderName: '起草者', content, status: 'streaming' }] : [],
  };
}

function delta(runId: string, sequence: number, text: string): RunEvent {
  return { version: 1, runId, turnId: `${runId}-turn`, requestId: `${runId}-request`, sequence, type: 'text_delta', timestamp: new Date().toISOString(), payload: { turnId: `${runId}-turn`, messageId: `${runId}-message`, senderName: '起草者', text } };
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
    fireEvent.click(screen.getByText('开始 Mock 协作'));
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
    fireEvent.click(screen.getByText('开始 Mock 协作'));
    fireEvent.click(screen.getByText('开始 Mock 协作'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('blocks Play and new rooms until the restored run snapshot arrives', () => {
    localStorage.setItem('roundtable.runId', 'restoring');
    subscribe.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect((screen.getByText('开始 Mock 协作') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('新建任务') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('开始 Mock 协作'));
    expect(start).not.toHaveBeenCalled();
  });

  it('displays workflow and message status in Simplified Chinese', async () => {
    localStorage.setItem('roundtable.runId', 'localized');
    const saved = snapshot('localized', 4, '定稿内容');
    saved.status = 'completed';
    saved.messages[0].status = 'completed';
    subscribe.mockResolvedValue({ snapshot: saved, events: [], nextCursor: 4, resyncRequired: false });
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('已完成')).toHaveLength(2));
  });
});
