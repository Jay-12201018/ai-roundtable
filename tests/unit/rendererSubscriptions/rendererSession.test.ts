import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';
import type { RunEvent, RunSubscription } from '../../../src/shared/types/run';
import { bridge, deferred, delta, marker, snapshot, subscription, time } from './fixtures';
import { publicError } from '../../../src/shared/schemas/error';

describe('Renderer subscription coordination', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });
  function setup() {
    const fake = bridge();
    const session = createRendererSession(fake.api, localStorage);
    const dispose = session.mount();
    return { ...fake, session, dispose, state: () => session.store.getState() };
  }
  const flush = () => vi.advanceTimersByTimeAsync(32);

  it('drops a conflicting same-sequence failure hint when authority has no safe reason', async () => {
    const { api, session, emit, state, dispose } = setup();
    try {
      await session.selectRun('run');
      const saved = snapshot('run', 3, '保留文本'); saved.status = 'error';
      vi.mocked(api.run.subscribe).mockResolvedValue({ ...subscription(saved), resyncRequired: true });
      for (const code of ['timeout','internal_error'] as const) emit({version:1,runId:'run',sequence:3,type:'turn_failed',turnId:'run-turn',requestId:'run-request',timestamp:time,payload:{turnId:'run-turn',messageId:'run-message',error:publicError(code)}});
      await flush();
      expect(state().error).toContain('请检查输入预算');
      expect(state().snapshot?.messages[0].content).toBe('保留文本');
    } finally { dispose(); }
  });

  it('does not restore an older failure after a newer running event', async () => {
    const { api, session, emit, state, dispose } = setup();
    const response = deferred<RunSubscription>();
    vi.mocked(api.run.subscribe).mockReturnValueOnce(response.promise);
    try {
      const loading = session.selectRun('run');
      emit({ version: 1, runId: 'run', sequence: 10, type: 'run_state_changed', timestamp: time, payload: { status: 'running' } });
      emit({ version: 1, runId: 'run', sequence: 8, turnId: 'run-turn', requestId: 'run-request', type: 'turn_failed', timestamp: time,
        payload: { turnId: 'run-turn', messageId: 'run-message', error: publicError('timeout') } });
      const saved = snapshot('run', 11, '旧尝试部分输出');
      saved.status = 'error'; saved.currentTurnId = undefined; saved.activeAgentId = undefined;
      saved.turns[0].status = 'failed'; saved.messages[0].status = 'failed'; saved.attempts![0].status = 'failed';
      response.resolve({ ...subscription(saved), resyncRequired: true });
      await loading;
      expect(state().syncStatus).toBe('ready');
      expect(state().error).toContain('请检查输入预算');
      expect(state().error).not.toContain('请求已超时');
      expect(api.run.subscribe).toHaveBeenCalledTimes(1);
    } finally { dispose(); }
  });

  it('attaches before subscribe and buffers only deltas newer than the snapshot', async () => {
    const { api, session, emit, state, dispose } = setup();
    const response = deferred<RunSubscription>();
    vi.mocked(api.run.subscribe).mockReturnValue(response.promise);
    const loading = session.selectRun('run');
    expect(vi.mocked(api.run.onEvent).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.run.subscribe).mock.invocationCallOrder[0]);
    emit(delta(3, '已在快照'));
    emit(delta(4, '新'));
    response.resolve(subscription(snapshot('run', 3, '旧')));
    await loading;
    await flush();
    expect(state().snapshot?.messages[0].content).toBe('旧新');
    expect(state().snapshot?.sequence).toBe(4);
    dispose();
  });

  it('sorts a contiguous burst, deduplicates it, and publishes once per flush', async () => {
    const { session, emit, state, dispose } = setup();
    await session.selectRun('run');
    const changes = vi.fn();
    const unwatch = session.store.subscribe(changes);
    emit(delta(4, '乙')); emit(delta(3, '甲')); emit(delta(3, '甲'));
    await flush();
    expect(state().snapshot?.messages[0].content).toBe('甲乙');
    expect(changes).toHaveBeenCalledTimes(1);
    emit(delta(3, '甲'));
    await flush();
    expect(state().snapshot?.messages[0].content).toBe('甲乙');
    unwatch(); dispose();
  });

  it('recovers gaps from Main without appending an untrusted tail or starting a request', async () => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(snapshot('run', 4, '权威完整文本')));
    emit(delta(4, '尾部'));
    await flush();
    expect(state().snapshot?.messages[0].content).toBe('权威完整文本');
    expect(api.run.start).not.toHaveBeenCalled();
    dispose();
  });

  it.each([2, 3])('consumes control marker %s without overwriting a same-sequence delta', async (sequence) => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    emit(delta(3, '新增')); emit(marker(sequence));
    await flush();
    expect(api.run.subscribe).toHaveBeenCalledTimes(2);
    expect(state().snapshot?.messages[0].content).toBe('新增');
    expect(state().snapshot?.sequence).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.run.subscribe).toHaveBeenCalledTimes(2);
    dispose();
  });

  it.each([
    { ...delta(3, '不兼容'), version: 9 },
    { ...delta(3, '未知'), type: 'future_event' },
    { ...delta(3, '错误身份'), requestId: 'other' },
  ])('resynchronizes incompatible or inconsistent incremental data', async (invalid) => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(snapshot('run', 3, '恢复')));
    emit(invalid as RunEvent);
    await flush();
    expect(state().snapshot?.messages[0].content).toBe('恢复');
    expect(api.run.subscribe).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('treats conflicting duplicate sequence payloads as untrusted', async () => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(snapshot('run', 3, '正确')));
    emit(delta(3, '甲')); emit(delta(3, '乙'));
    await flush();
    expect(state().snapshot?.messages[0].content).toBe('正确');
    dispose();
  });

  it('reconciles terminal text, turn, attempt and active pointers from one snapshot', async () => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    const final = snapshot('run', 4, '最终文本');
    final.status = 'completed'; final.currentTurnId = undefined; final.activeAgentId = undefined;
    final.turns[0].status = 'completed'; final.turns[0].outputText = '最终文本';
    final.messages[0].status = 'completed'; final.attempts![0].status = 'completed';
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(final));
    emit(delta(3, '暂时文本'));
    emit({ version: 1, runId: 'run', turnId: 'run-turn', requestId: 'run-request', sequence: 4, type: 'turn_completed', payload: { turnId: 'run-turn', messageId: 'run-message' }, timestamp: time });
    await flush();
    expect(state().snapshot).toEqual(final);
    dispose();
  });

  it('rejects late snapshots and events after switching between rooms and runs', async () => {
    const { api, session, emit, state, dispose } = setup();
    const late = deferred<RunSubscription>();
    vi.mocked(api.run.subscribe).mockReturnValueOnce(late.promise);
    const first = session.selectRun('old');
    await session.selectRun('new');
    late.resolve(subscription(snapshot('old', 90, '迟到')));
    await first;
    emit(delta(91, '旧', 'old')); emit(delta(3, '新', 'new'));
    await flush();
    expect(state().roomId).toBe('new-room');
    expect(state().snapshot?.messages[0].content).toBe('新');
    session.selectRoom('other-room');
    emit(delta(4, '不该出现', 'new'));
    await flush();
    expect(state().roomId).toBe('other-room');
    expect(state().snapshot).toBeUndefined();
    dispose();
  });

  it('ignores a stale rejected subscription and releases listeners/timers on remount', async () => {
    const { api, session, emit, listeners, state, dispose } = setup();
    const late = deferred<RunSubscription>();
    vi.mocked(api.run.subscribe).mockReturnValueOnce(late.promise);
    const loading = session.selectRun('old');
    dispose();
    expect(listeners.size).toBe(0);
    const again = session.mount();
    await session.selectRun('new');
    const unrelatedTimers = vi.getTimerCount();
    emit(delta(3, '取消定时器', 'new'));
    expect(vi.getTimerCount()).toBe(unrelatedTimers + 1);
    again();
    expect(vi.getTimerCount()).toBe(unrelatedTimers);
    late.reject(new Error('私有路径不得显示'));
    await loading;
    expect(state().error).toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it('bounds a non-advancing gap and allows an explicit sync retry', async () => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    emit(delta(8, '无法覆盖'));
    await flush();
    expect(vi.mocked(api.run.subscribe).mock.calls.length).toBeLessThanOrEqual(3);
    expect(state().syncStatus).toBe('error');
    expect(state().snapshot?.sequence).toBe(2);
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(snapshot('run', 8, '恢复成功')));
    await session.synchronize();
    expect(state().snapshot?.messages[0].content).toBe('恢复成功');
    expect(state().syncStatus).toBe('ready');
    dispose();
  });

  it('keeps catching up while authoritative snapshots advance during successive structural events', async () => {
    const { api, session, emit, state, dispose } = setup();
    await session.selectRun('run');
    let reads = 0;
    vi.mocked(api.run.subscribe).mockImplementation(async () => {
      const saved = snapshot('run', 3 + reads++);
      if (reads < 4) emit({ version: 1, runId: 'run', sequence: saved.sequence + 1, type: 'run_state_changed', payload: { status: 'running' }, timestamp: time });
      return subscription(saved);
    });
    await session.synchronize();
    expect(state().syncStatus).toBe('ready');
    expect(state().snapshot?.sequence).toBe(6);
    expect(reads).toBe(4);
    dispose();
  });

  it('rejects inconsistent subscription identities and does not expose raw errors', async () => {
    const { api, session, state, dispose } = setup();
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(snapshot('wrong')));
    await session.selectRun('run');
    expect(state().snapshot).toBeUndefined();
    expect(state().syncStatus).toBe('error');
    expect(state().error).toMatch(/同步/);
    dispose();
  });
});

describe('Renderer lifecycle failure boundaries', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it('retries a synchronous subscribe failure instead of retaining a completed flight', async () => {
    const { api } = bridge();
    const session = createRendererSession(api, localStorage);
    const dispose = session.mount();
    vi.mocked(api.run.subscribe).mockImplementationOnce(() => { throw new Error('transport'); });
    await session.selectRun('run');
    expect(session.store.getState().syncStatus).toBe('error');
    await session.synchronize();
    expect(session.store.getState().syncStatus).toBe('ready');
    expect(session.store.getState().snapshot?.runId).toBe('run');
    dispose();
  });

  it('mount is idempotent and its disposer can safely be called twice', async () => {
    const { api, listeners } = bridge();
    const session = createRendererSession(api, localStorage);
    const first = session.mount();
    const second = session.mount();
    expect(listeners.size).toBe(1);
    expect(api.run.onEvent).toHaveBeenCalledTimes(1);
    first(); first(); second();
    expect(listeners.size).toBe(0);
    const again = session.mount();
    expect(listeners.size).toBe(1);
    again();
  });

  it('does not use persisted text as authority or call Main for a malformed saved identity', async () => {
    const { api } = bridge();
    localStorage.setItem('roundtable.runId', 'invalid identity');
    const session = createRendererSession(api, localStorage);
    const dispose = session.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.run.subscribe).not.toHaveBeenCalled();
    expect(session.store.getState().snapshot).toBeUndefined();
    expect(session.store.getState().syncStatus).toBe('error');
    dispose();
  });
});
