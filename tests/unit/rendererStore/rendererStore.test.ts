import { describe, expect, it, vi } from 'vitest';
import { canCommand, createRendererStore, selectTaskTitle, type RendererCommand } from '../../../src/renderer/store/rendererStore';
import { runStatusValues, type RunEvent, type RunSnapshot } from '../../../src/shared/types/run';

const time = '2026-10-15T01:00:00.000Z';
const later = '2026-10-15T01:00:01.000Z';

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: 'run', roomId: 'room', sequence: 2, status: 'running', workflowSnapshot: {}, updatedAt: time,
    currentTurnId: 'turn', activeAgentId: 'agent',
    turns: [{ runId: 'run', turnId: 'turn', agentId: 'agent', requestId: 'request', messageId: 'message', status: 'running', outputText: '保留' }],
    messages: [{ id: 'message', senderName: '起草者', content: '保留', status: 'streaming' }],
    ...overrides,
  };
}

function delta(sequence: number, text: string): Extract<RunEvent, { type: 'text_delta' }> {
  return {
    version: 1, type: 'text_delta', runId: 'run', turnId: 'turn', requestId: 'request', sequence, timestamp: later,
    payload: { turnId: 'turn', messageId: 'message', senderName: '起草者', text },
  };
}

function selected(overrides: Partial<RunSnapshot> = {}) {
  const store = createRendererStore();
  store.getState().selectRun('run');
  store.getState().applySnapshot(snapshot(overrides), store.getState().generation);
  store.getState().setSyncStatus('ready', store.getState().generation);
  return store;
}

describe('Renderer authoritative projection', () => {
  it('publishes snapshot, messages, selection and cursor together', () => {
    const store = createRendererStore();
    store.getState().selectRun('run');
    const changes = vi.fn();
    store.subscribe(changes);
    expect(store.getState().applySnapshot(snapshot(), store.getState().generation)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ roomId: 'room', runId: 'run', snapshot: { sequence: 2, messages: [{ content: '保留' }] } });
  });

  it('does not overwrite a new selection with a late snapshot or failure', () => {
    const store = selected();
    const oldGeneration = store.getState().generation;
    store.getState().selectRun('other');
    const current = store.getState();
    expect(current.applySnapshot(snapshot(), oldGeneration)).toBe(false);
    current.setError('旧错误', oldGeneration);
    current.setSyncStatus('error', oldGeneration);
    expect(store.getState()).toBe(current);
    expect(current.applySnapshot(snapshot(), current.generation)).toBe(false);
    expect(store.getState()).toBe(current);
  });

  it('rejects wrong rooms, malformed snapshots and cursor regressions', () => {
    const store = selected();
    const current = store.getState();
    expect(current.applySnapshot(snapshot({ sequence: 1 }), current.generation)).toBe(false);
    expect(current.applySnapshot(snapshot({ roomId: 'other-room' }), current.generation)).toBe(false);
    expect(current.applySnapshot(snapshot({ turns: [{ ...snapshot().turns[0], runId: 'other' }] }), current.generation)).toBe(false);
    expect(store.getState()).toBe(current);
    current.selectRoom('selected-room', '房间任务');
    expect(store.getState().applySnapshot(snapshot(), store.getState().generation)).toBe(false);
  });

  it('applies consecutive deltas atomically without mutating the authoritative input', () => {
    const input = snapshot();
    const store = selected();
    store.getState().applySnapshot(input, store.getState().generation);
    const changes = vi.fn();
    store.subscribe(changes);
    expect(store.getState().applyDeltas([delta(3, '中文'), delta(4, '正文')], store.getState().generation)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshot).toMatchObject({ sequence: 4, updatedAt: later, messages: [{ content: '保留中文正文' }], turns: [{ outputText: '保留中文正文' }] });
    expect(input).toMatchObject({ sequence: 2, messages: [{ content: '保留' }], turns: [{ outputText: '保留' }] });
  });

  it('advances public reasoning and usage events without inventing message text', () => {
    const store = selected();
    const reasoning: RunEvent = { ...delta(3, '公开摘要'), type: 'reasoning_summary_delta' };
    const usage: RunEvent = { version: 1, type: 'usage_updated', runId: 'run', turnId: 'turn', requestId: 'request', sequence: 4, timestamp: later, payload: { turnId: 'turn', inputTokens: 3, outputTokens: 4 } };
    expect(store.getState().applyDeltas([reasoning, usage], store.getState().generation)).toBe(true);
    expect(store.getState().snapshot).toMatchObject({ sequence: 4, messages: [{ content: '保留' }], turns: [{ outputText: '保留' }] });
  });

  it.each([
    ['duplicate', [delta(2, '重复')]],
    ['out of order', [delta(4, '尾部'), delta(3, '头部')]],
    ['gap', [delta(3, '前部'), delta(5, '缺口')]],
    ['wrong run', [{ ...delta(3, '旧数据'), runId: 'old' }]],
    ['wrong request', [{ ...delta(3, '旧数据'), requestId: 'old-request' }]],
    ['wrong turn', [{ ...delta(3, '旧数据'), turnId: 'other-turn' }]],
    ['wrong message', [{ ...delta(3, '旧数据'), payload: { ...delta(3, '').payload, messageId: 'other-message' } }]],
    ['wrong sender', [{ ...delta(3, '旧数据'), payload: { ...delta(3, '').payload, senderName: '陌生发言者' } }]],
    ['malformed', [{ ...delta(3, '旧数据'), version: 2 }]],
    ['structure event', [{ version: 1, type: 'run_state_changed', runId: 'run', sequence: 3, timestamp: later, payload: { status: 'completed' } }]],
  ])('rejects %s without partial projection', (_name, events) => {
    const store = selected();
    const current = store.getState();
    expect(current.applyDeltas(events as RunEvent[], current.generation)).toBe(false);
    expect(store.getState()).toBe(current);
  });

  it('rejects the entire batch when a later identity is untrusted', () => {
    const store = selected();
    const current = store.getState();
    expect(current.applyDeltas([delta(3, '不应出现'), { ...delta(4, '错误'), requestId: 'unknown' }], current.generation)).toBe(false);
    expect(store.getState()).toBe(current);
    expect(current.applyDeltas([delta(3, '旧代')], current.generation - 1)).toBe(false);
  });

  it.each(['requestId', 'messageId'] as const)('does not guess missing turn %s', (field) => {
    const original = snapshot();
    delete original.turns[0][field];
    const store = selected(original);
    expect(store.getState().applyDeltas([delta(3, '伪造关联')], store.getState().generation)).toBe(false);
  });

  it('requires attempt identity when the snapshot includes request attempts', () => {
    const store = selected({ attempts: [] });
    expect(store.getState().applyDeltas([delta(3, '无尝试')], store.getState().generation)).toBe(false);
  });

  it('accepts the current request attempt and rejects a retained older attempt', () => {
    const attempt: NonNullable<RunSnapshot['attempts']>[number] = { runId: 'run', turnId: 'turn', requestId: 'request', messageId: 'message', attemptIndex: 1, status: 'running', createdAt: time, startedAt: time, finishedAt: null, updatedAt: time };
    const store = selected({
      messages: [...snapshot().messages, { id: 'old-message', senderName: '起草者', content: '旧尝试部分输出', status: 'aborted' }],
      attempts: [{ ...attempt, requestId: 'old-request', messageId: 'old-message', attemptIndex: 0, status: 'aborted' }, attempt],
    });
    expect(store.getState().applyDeltas([delta(3, '新尝试')], store.getState().generation)).toBe(true);
    const stale = delta(4, '旧尝试迟到');
    stale.requestId = 'old-request';
    stale.payload.messageId = 'old-message';
    const current = store.getState();
    expect(current.applyDeltas([stale], current.generation)).toBe(false);
    expect(store.getState()).toBe(current);
    expect(current.snapshot?.messages[1].content).toBe('旧尝试部分输出');
  });

  it('never appends late text to a completed message or completed turn', () => {
    const messageDone = selected({ messages: [{ ...snapshot().messages[0], status: 'completed' }] });
    expect(messageDone.getState().applyDeltas([delta(3, '迟到')], messageDone.getState().generation)).toBe(false);
    const turnDone = selected({ turns: [{ ...snapshot().turns[0], status: 'completed' }], currentTurnId: undefined, activeAgentId: undefined });
    expect(turnDone.getState().applyDeltas([delta(3, '迟到')], turnDone.getState().generation)).toBe(false);
  });
});

describe('Renderer task identity and command gates', () => {
  it('keeps draft separate from created-room and durable run titles', () => {
    const store = createRendererStore();
    store.getState().setDraft('草稿一');
    expect(selectTaskTitle(store.getState())).toBe('新任务');
    store.getState().selectRoom('room', '创建时的目标');
    store.getState().setDraft('草稿二');
    expect(selectTaskTitle(store.getState())).toBe('创建时的目标');
    store.getState().selectRun('run');
    store.getState().applySnapshot(snapshot(), store.getState().generation);
    expect(selectTaskTitle(store.getState())).toBe('历史任务（目标未记录）');
    const execution: NonNullable<RunSnapshot['execution']> = { task: '持久化目标', membersSnapshot: null, nextTurnIndex: 0, elapsedExecutionMs: 0, mode: 'automatic', maxTurns: 3, maxDurationMs: 1000, outputTokenLimit: 1000, currentTurnId: 'turn', currentAgentId: 'agent', startedAt: time, finishedAt: null, createdAt: time, updatedAt: time };
    store.getState().applySnapshot(snapshot({ execution }), store.getState().generation);
    expect(selectTaskTitle(store.getState())).toBe('持久化目标');
    store.getState().setDraft('再次修改');
    expect(selectTaskTitle(store.getState())).toBe('持久化目标');
  });

  it('invalidates pending commands and previous projection on every selection', () => {
    const store = selected();
    store.getState().setError('故障', store.getState().generation);
    store.getState().beginCommand('pause');
    const previousGeneration = store.getState().generation;
    store.getState().selectRoom('next', '下一任务');
    expect(store.getState()).toMatchObject({ generation: previousGeneration + 1, roomId: 'next', roomTask: '下一任务', syncStatus: 'idle' });
    expect(store.getState().runId).toBeUndefined();
    expect(store.getState().snapshot).toBeUndefined();
    expect(store.getState().pending).toBeUndefined();
    expect(store.getState().error).toBeUndefined();
  });

  it.each([
    ['idle', ['create', 'start']],
    ['running', ['pause', 'stop']],
    ['pausing', ['stop']],
    ['paused', ['stop', 'step', 'resumeRun']],
    ['cancelling', []],
    ['cancelled', ['create', 'start']],
    ['completed', ['create', 'start']],
    ['error', ['create', 'start']],
    ['interrupted', ['create', 'start']],
  ] as const)('offers only legal commands for %s', (status, allowed) => {
    expect(runStatusValues).toContain(status);
    const store = selected({ status });
    const commands: RendererCommand[] = ['create', 'start', 'pause', 'stop', 'step', 'resumeRun'];
    expect(commands.filter((command) => canCommand(store.getState(), command))).toEqual(allowed);
  });

  it('blocks commands during restore, on sync failure, and for empty new-task drafts', () => {
    const store = selected();
    for (const status of ['syncing', 'error'] as const) {
      store.getState().setSyncStatus(status, store.getState().generation);
      expect(canCommand(store.getState(), 'pause')).toBe(false);
      expect(canCommand(store.getState(), 'stop')).toBe(false);
    }
    store.getState().selectRoom();
    store.getState().setDraft('   ');
    expect(canCommand(store.getState(), 'create')).toBe(false);
    expect(canCommand(store.getState(), 'start')).toBe(false);
    store.getState().setDraft('任务');
    expect(canCommand(store.getState(), 'start')).toBe(true);
    expect(canCommand(store.getState(), 'stop')).toBe(false);
  });

  it('allows one command token and ignores late token completion', () => {
    const store = createRendererStore();
    const first = store.getState().beginCommand('create');
    expect(first).toBeTypeOf('number');
    expect(store.getState().pending).toMatchObject({ id: first, command: 'create', generation: 0, sequence: 0 });
    expect(store.getState().beginCommand('start')).toBeUndefined();
    store.getState().selectRoom('room', '目标');
    const second = store.getState().beginCommand('start');
    expect(second).not.toBe(first);
    store.getState().endCommand(first!);
    expect(store.getState().pending?.id).toBe(second);
    store.getState().endCommand(second!);
    expect(store.getState().pending).toBeUndefined();
  });

  it.each([
    ['pause', 'running', 'pausing'],
    ['step', 'paused', 'running'],
    ['resumeRun', 'paused', 'running'],
    ['stop', 'running', 'cancelling'],
  ] as const)('releases %s after a newer Main snapshot confirms it', (command, source, next) => {
    const store = selected({ status: source });
    store.getState().beginCommand(command);
    store.getState().applySnapshot(snapshot({ status: next, sequence: 2 }), store.getState().generation);
    expect(store.getState().pending?.command).toBe(command);
    store.getState().applySnapshot(snapshot({ status: source, sequence: 3 }), store.getState().generation);
    expect(store.getState().pending?.command).toBe(command);
    store.getState().applySnapshot(snapshot({ status: next, sequence: 4 }), store.getState().generation);
    expect(store.getState().pending).toBeUndefined();
    if (next === 'running' || next === 'pausing') expect(canCommand(store.getState(), 'stop')).toBe(true);
  });

  it('does not infer completion of create/start from unrelated snapshots', () => {
    const store = selected({ status: 'completed' });
    const token = store.getState().beginCommand('start');
    store.getState().applySnapshot(snapshot({ status: 'running', sequence: 3 }), store.getState().generation);
    expect(store.getState().pending?.id).toBe(token);
  });

  it.each(['cancelled', 'completed', 'error', 'interrupted'] as const)('releases Stop after Main has reached %s', (status) => {
    const store = selected();
    store.getState().beginCommand('stop');
    store.getState().applySnapshot(snapshot({ status, sequence: 3 }), store.getState().generation);
    expect(store.getState().pending).toBeUndefined();
    expect(canCommand(store.getState(), 'start')).toBe(true);
  });
});
