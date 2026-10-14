// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { RunService } from '../../../src/main/services/RunService';
import { registerIpc } from '../../../src/main/ipc/registerIpc';
import { ContractError } from '../../../src/shared/contracts/errors';

const fixture = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), listener: undefined as ((event: unknown) => void) | undefined }));
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => fixture.handlers.set(channel, handler),
  removeHandler: (channel: string) => fixture.handlers.delete(channel),
} }));
vi.mock('../../../src/main/windows/createMainWindow', () => ({ isTrustedIpcSender: () => true, isTrustedRenderer: () => true }));
const snapshot = { runId: 'r', roomId: 'room', status: 'running', sequence: 0, workflowSnapshot: {}, turns: [], messages: [], updatedAt: '2026-10-14T00:00:00.000Z' };
const send = vi.fn();
const start = vi.fn(async () => snapshot);
const getSnapshot = vi.fn(() => snapshot);
const recover = vi.fn(async (_runId: string, _decision: string) => {});
beforeEach(() => {
  vi.clearAllMocks();
  start.mockResolvedValue(snapshot); getSnapshot.mockReturnValue(snapshot);
  registerIpc({ webContents: { send } } as unknown as BrowserWindow, {
    start, getSnapshot, recoverInterruptedRun: recover,
    createDemoRoom: () => 'room', getMessages: () => [],
    onEvent: (listener: (event: unknown) => void) => { fixture.listener = listener; return () => {}; },
  } as unknown as RunService);
});
const invoke = (channel: string, ...args: unknown[]) => fixture.handlers.get(channel)!({}, ...args);
describe('IPC runtime contract', () => {
  it('wraps only validated responses in the versioned success envelope', async () => {
    expect(await invoke('run.getSnapshot', 'r')).toEqual({ version: 1, ok: true, data: snapshot });
  });
  it.each([
    { roomId: 'room', task: 't', workflowSnapshot: {}, apiKey: 'fixture-secret' },
    { roomId: ' ', task: 't', workflowSnapshot: {} },
    { roomId: 'room', task: 't', workflowSnapshot: {}, mode: 'wrong' },
  ])('rejects invalid inputs before service execution %#', async (input) => {
    expect(await invoke('run.start', input)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(start).not.toHaveBeenCalled();
  });
  it('rejects extra positional arguments as well as extra object fields', async () => {
    expect(await invoke('run.getSnapshot', 'r', 'extra')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(getSnapshot).not.toHaveBeenCalled();
  });
  it('reports only approved field names for input errors', async () => {
    const invalidId = await invoke('run.start', { roomId: ' ', task: 'fixture', workflowSnapshot: {} });
    expect(invalidId).toMatchObject({ error: { code: 'invalid_input', field: 'roomId' } });
    const unknownField = await invoke('run.start', { roomId: 'room', task: 'fixture', workflowSnapshot: {}, 'fixture-secret': 'fixture-secret' });
    expect(unknownField).toMatchObject({ error: { field: 'arguments' } });
    expect(JSON.stringify(unknownField)).not.toContain('fixture-secret');
  });
  it('rejects malformed and cross-run service responses', async () => {
    getSnapshot.mockReturnValueOnce({ ...snapshot, runId: 'other' });
    expect(await invoke('run.getSnapshot', 'r')).toMatchObject({ ok: false, error: { code: 'invalid_response' } });
    getSnapshot.mockReturnValueOnce({ ...snapshot, status: 'wrong' });
    expect(await invoke('run.getSnapshot', 'r')).toMatchObject({ ok: false, error: { code: 'invalid_response' } });
  });
  it('never returns raw exception messages, inputs or stacks', async () => {
    getSnapshot.mockImplementationOnce(() => { throw new Error('fixture-secret stack path'); });
    const result = await invoke('run.getSnapshot', 'r');
    expect(result).toMatchObject({ ok: false, error: { code: 'internal_error', retryable: false } });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|stack|path/);
  });
  it('validates structured errors as well as success responses', async () => {
    const error = new ContractError('internal_error');
    error.detail.message = 'fixture-secret';
    getSnapshot.mockImplementationOnce(() => { throw error; });
    expect(await invoke('run.getSnapshot', 'r')).toMatchObject({ error: { code: 'internal_error', message: 'Operation failed' } });
  });
  it('accepts all four approved recovery decisions at the same input boundary', async () => {
    for (const decision of ['inspect', 'resume', 'retry', 'discard']) {
      expect(await invoke('run.recoverInterruptedRun', { runId: 'r', decision })).toMatchObject({ ok: true });
    }
    expect(recover.mock.calls.map((call) => call[1])).toEqual(['inspect', 'resume', 'retry', 'discard']);
  });
  it('replaces malformed events with a safe resynchronization signal', () => {
    fixture.listener!({ runId: 'r', sequence: 3, type: 'future', payload: { secret: 'fixture-secret' } });
    expect(send).toHaveBeenCalledWith('run.event', expect.objectContaining({ version: 1, runId: 'r', sequence: 3, type: 'snapshot_required', payload: { reason: 'invalid_event' } }));
    expect(JSON.stringify(send.mock.calls)).not.toContain('fixture-secret');
  });
});
