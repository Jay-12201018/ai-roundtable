import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { bridge, deferred, marker, snapshot, subscription } from './fixtures';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
function setup() {
  const fake = bridge();
  const session = createRendererSession(fake.api, localStorage);
  const dispose = session.mount();
  return { ...fake, session, dispose, state: () => session.store.getState() };
}
function paused() {
  const saved = snapshot();
  saved.status = 'paused'; saved.currentTurnId = undefined; saved.activeAgentId = undefined;
  saved.turns[0].status = 'completed'; saved.messages[0].status = 'completed';
  return saved;
}

describe('Renderer command ownership', () => {
  it('locks create/start together and captures the submitted draft before awaiting IPC', async () => {
    const { api, session, state, dispose } = setup();
    const created = deferred<{ roomId: string }>();
    vi.mocked(api.room.createDemo).mockReturnValue(created.promise);
    state().setDraft('提交时的目标');
    const saving = session.createRoom();
    state().setDraft('新的草稿');
    await session.createRoom(); await session.startRun();
    expect(api.room.createDemo).toHaveBeenCalledExactlyOnceWith('提交时的目标');
    expect(api.run.start).not.toHaveBeenCalled();
    created.resolve({ roomId: 'captured-room' });
    await saving;
    expect(state().roomTask).toBe('提交时的目标');
    expect(state().draft).toBe('新的草稿');
    expect(state().pending).toBeUndefined();
    dispose();
  });

  it('starts once using its captured task even if the draft changes during room creation', async () => {
    const { api, session, state, dispose } = setup();
    const created = deferred<{ roomId: string }>();
    vi.mocked(api.room.createDemo).mockReturnValue(created.promise);
    const started = snapshot('new'); started.roomId = 'created-room';
    vi.mocked(api.run.start).mockResolvedValue(started);
    state().setDraft('固定目标');
    const starting = session.startRun();
    state().setDraft('之后的草稿');
    await session.startRun();
    created.resolve({ roomId: 'created-room' });
    await starting;
    expect(api.run.start).toHaveBeenCalledExactlyOnceWith({ roomId: 'created-room', task: '固定目标', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
    expect(state().runId).toBe('new');
    expect(state().draft).toBe('之后的草稿');
    expect(localStorage.getItem('roundtable.runId')).toBe('new');
    dispose();
  });

  it('does not start after a stale create response or overwrite a newly selected room', async () => {
    const { api, session, state, dispose } = setup();
    const created = deferred<{ roomId: string }>();
    vi.mocked(api.room.createDemo).mockReturnValue(created.promise);
    const starting = session.startRun();
    session.selectRoom('selected');
    created.resolve({ roomId: 'old' });
    await starting;
    expect(api.run.start).not.toHaveBeenCalled();
    expect(state().roomId).toBe('selected');
    dispose();
  });

  it('does not persist or select a late start response after switching away', async () => {
    const { api, session, state, dispose } = setup();
    session.selectRoom('created-room');
    const response = deferred<RunSnapshot>();
    vi.mocked(api.run.start).mockReturnValue(response.promise);
    const starting = session.startRun();
    await session.selectRun('other');
    response.resolve(snapshot('late'));
    await starting;
    expect(state().runId).toBe('other');
    expect(localStorage.getItem('roundtable.runId')).toBe('other');
    dispose();
  });

  it.each(['pause', 'stop', 'step', 'resumeRun'] as const)('suppresses duplicate %s and competing commands while pending', async (command) => {
    const { api, session, state, dispose } = setup();
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(command === 'pause' || command === 'stop' ? snapshot() : paused()));
    await session.selectRun('run');
    const response = deferred<void>();
    vi.mocked(api.run[command]).mockReturnValue(response.promise);
    const operation = session.control(command);
    await session.control(command); await session.createRoom(); await session.startRun();
    expect(api.run[command]).toHaveBeenCalledTimes(1);
    expect(api.room.createDemo).not.toHaveBeenCalled();
    expect(state().pending?.command).toBe(command);
    response.resolve(); await operation;
    expect(state().pending).toBeUndefined();
    dispose();
  });

  it.each(['step', 'resumeRun'] as const)('allows Stop after Main confirms %s while its original Promise is unresolved', async (command) => {
    const { api, session, emit, state, dispose } = setup();
    vi.mocked(api.run.subscribe).mockResolvedValueOnce(subscription(paused()));
    await session.selectRun('run');
    const old = deferred<void>();
    vi.mocked(api.run[command]).mockReturnValue(old.promise);
    const running = session.control(command);
    vi.mocked(api.run.subscribe).mockResolvedValue(subscription(snapshot('run', 3)));
    emit(marker(3));
    await vi.advanceTimersByTimeAsync(32);
    expect(state().pending).toBeUndefined();
    const stopping = deferred<void>();
    vi.mocked(api.run.stop).mockReturnValue(stopping.promise);
    const stopped = session.control('stop');
    expect(state().pending?.command).toBe('stop');
    old.resolve(); await running;
    expect(state().pending?.command).toBe('stop');
    stopping.resolve(); await stopped;
    dispose();
  });

  it('clears failed pending state, keeps partial output and hides internal exception details', async () => {
    const { api, session, state, dispose } = setup();
    await session.selectRun('run');
    vi.mocked(api.run.pause).mockRejectedValue(new Error('/private/database/key details'));
    await session.control('pause');
    expect(state().pending).toBeUndefined();
    expect(state().snapshot?.runId).toBe('run');
    expect(state().error).toMatch(/失败/);
    expect(state().error).not.toContain('/private');
    dispose();
  });

  it('ignores errors and finalizers from old commands after selecting another Run', async () => {
    const { api, session, state, dispose } = setup();
    await session.selectRun('run');
    const old = deferred<void>();
    vi.mocked(api.run.pause).mockReturnValue(old.promise);
    const pausing = session.control('pause');
    await session.selectRun('new');
    const current = deferred<void>();
    vi.mocked(api.run.pause).mockReturnValue(current.promise);
    const next = session.control('pause');
    old.reject(new Error('旧错误'));
    await pausing;
    expect(state().pending?.command).toBe('pause');
    expect(state().error).toBeUndefined();
    expect(state().runId).toBe('new');
    current.resolve(); await next;
    dispose();
  });

  it('restores an existing task solely through subscribe without calling recovery or start', async () => {
    localStorage.setItem('roundtable.runId', 'interrupted');
    const { api, state, dispose } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().snapshot?.execution?.task).toBe('持久任务');
    expect(api.run.start).not.toHaveBeenCalled();
    expect(api.run.recoverInterruptedRun).not.toHaveBeenCalled();
    dispose();
  });
});
