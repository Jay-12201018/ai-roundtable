import { vi } from 'vitest';
import type { RunSessionApiContract } from '../../../src/shared/contracts/app';
import type { RunEvent, RunSnapshot, RunSubscription } from '../../../src/shared/types/run';

export const time = '2026-10-15T00:00:00.000Z';
export function snapshot(runId = 'run', sequence = 2, content = ''): RunSnapshot {
  return {
    runId, roomId: `${runId}-room`, status: 'running', sequence, workflowSnapshot: {}, updatedAt: time,
    currentTurnId: `${runId}-turn`, activeAgentId: 'agent',
    turns: [{ turnId: `${runId}-turn`, runId, agentId: 'agent', requestId: `${runId}-request`, messageId: `${runId}-message`, status: 'running', outputText: content }],
    messages: [{ id: `${runId}-message`, senderName: '起草者', content, status: 'streaming' }],
    execution: { task: '持久任务', membersSnapshot: [], nextTurnIndex: 0, elapsedExecutionMs: 0, mode: 'automatic', maxTurns: 3, maxDurationMs: 300000, outputTokenLimit: 1024, currentTurnId: `${runId}-turn`, currentAgentId: 'agent', startedAt: time, finishedAt: null, createdAt: time, updatedAt: time },
    attempts: [{ requestId: `${runId}-request`, runId, turnId: `${runId}-turn`, messageId: `${runId}-message`, attemptIndex: 0, status: 'running', createdAt: time, startedAt: time, finishedAt: null, updatedAt: time }],
  };
}
export function subscription(saved = snapshot()): RunSubscription {
  return { snapshot: saved, events: [], nextCursor: saved.sequence, resyncRequired: false };
}
export function delta(sequence: number, text: string, runId = 'run'): Extract<RunEvent, { type: 'text_delta' }> {
  return { version: 1, runId, turnId: `${runId}-turn`, requestId: `${runId}-request`, sequence, type: 'text_delta', timestamp: time, payload: { turnId: `${runId}-turn`, messageId: `${runId}-message`, senderName: '起草者', text } };
}
export function marker(sequence = 3, runId = 'run'): RunEvent {
  return { version: 1, runId, sequence, type: 'snapshot_required', timestamp: time, payload: { reason: 'invalid_event' } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function bridge() {
  const listeners = new Set<(event: RunEvent) => void>();
  const api: RunSessionApiContract = {
    room: { createDemo: vi.fn(async () => ({ roomId: 'created-room' })), getMessages: vi.fn(async () => []) },
    run: {
      previewWorkflow: vi.fn(async () => { throw new Error('Workflow preview not configured in fixture'); }),
      subscribe: vi.fn(async (id) => subscription(snapshot(id))), getSnapshot: vi.fn(async (id) => snapshot(id)),
      start: vi.fn(async (input) => ({ ...snapshot('new'), roomId: input.roomId })),
      onEvent: vi.fn((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
      pause: vi.fn(async () => {}), stop: vi.fn(async () => {}), step: vi.fn(async () => {}), resumeRun: vi.fn(async () => {}),
      retryTurn: vi.fn(async () => {}), continueMessage: vi.fn(async () => {}), recoverInterruptedRun: vi.fn(async () => {}),
    },
  };
  return { api, listeners, emit: (event: RunEvent) => listeners.forEach(listener => listener(event)) };
}
