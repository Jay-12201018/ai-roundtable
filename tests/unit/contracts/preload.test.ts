// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoundtableApiContract } from '../../../src/shared/contracts/app';

const fixture = vi.hoisted(() => ({ invoke: vi.fn(), handlers: new Set<(...args: unknown[]) => void>(), api: undefined as RoundtableApiContract | undefined }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: RoundtableApiContract) => { fixture.api = api; } },
  ipcRenderer: {
    invoke: fixture.invoke,
    on: (_channel: string, listener: (...args: unknown[]) => void) => fixture.handlers.add(listener),
    removeListener: (_channel: string, listener: (...args: unknown[]) => void) => fixture.handlers.delete(listener),
  },
}));
import '../../../src/preload';
const snapshot = { runId: 'r', roomId: 'room', status: 'running', sequence: 4, workflowSnapshot: {}, turns: [], messages: [], updatedAt: '2026-10-14T00:00:00.000Z' };
const emit = (value: unknown) => { for (const handler of fixture.handlers) handler({}, value); };
beforeEach(() => { fixture.invoke.mockReset(); fixture.handlers.clear(); });
describe('restricted Preload contract', () => {
  it('unwraps validated responses without exposing the IPC envelope', async () => {
    fixture.invoke.mockResolvedValue({ version: 1, ok: true, data: snapshot });
    expect(await fixture.api!.run.getSnapshot('r')).toEqual(snapshot);
  });
  it.each([
    { version: 2, ok: true, data: snapshot },
    { version: 1, ok: true, data: { ...snapshot, runId: 'other' } },
    { version: 1, ok: true, data: { ...snapshot, apiKey: 'fixture-secret' } },
    { version: 1, ok: false, error: { code: 'unsupported', message: 'fixture-secret', retryable: false } },
  ])('rejects incompatible or polluted responses %#', async (value) => {
    fixture.invoke.mockResolvedValue(value);
    await expect(fixture.api!.run.getSnapshot('r')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('validates before invoking and sanitizes transport rejections', async () => {
    await expect(fixture.api!.run.getSnapshot(' ')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fixture.invoke).not.toHaveBeenCalled();
    fixture.invoke.mockRejectedValue(new Error('fixture-secret'));
    await expect(fixture.api!.run.getSnapshot('r')).rejects.toMatchObject({ code: 'transport_error', message: 'IPC connection failed' });
  });
  it('does not expose internal paths or stacks when the bridge rejects a request', async () => {
    fixture.invoke.mockRejectedValue(new Error('fixture-secret'));
    const error = await fixture.api!.run.getSnapshot('r').catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).stack).not.toMatch(/\bat\s|\.ts|\.cjs|\//);
  });
  it('turns unknown-version events into a safe snapshot request and releases listeners', async () => {
    fixture.invoke.mockResolvedValue({ version: 1, ok: true, data: snapshot });
    await fixture.api!.run.getSnapshot('r');
    const listener = vi.fn();
    const unsubscribe = fixture.api!.run.onEvent(listener);
    emit({ version: 2, runId: 'r', sequence: 5, type: 'future', payload: { secret: 'fixture-secret' } });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ version: 1, type: 'snapshot_required', runId: 'r', sequence: 5, payload: { reason: 'incompatible_version' } }));
    expect(JSON.stringify(listener.mock.calls)).not.toContain('fixture-secret');
    unsubscribe(); unsubscribe();
    emit({ version: 2, runId: 'r' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
