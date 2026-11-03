// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoundtableApiContract } from '../../../src/shared/contracts/app';
import { apiErrorSchema } from '../../../src/shared/schemas/error';

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
  it('exposes only typed feature methods and sends one explicit undefined argument for no-input requests', async () => {
    expect(Object.keys(fixture.api!).sort()).toEqual(['app', 'artifact', 'codeExport', 'host', 'network', 'room', 'rooms', 'run', 'settings', 'summary', 'usage']);
    // D115: saved proxy settings, a keyless proxy check and a restart; no generic file or process access.
    expect(Object.keys(fixture.api!.network!)).toEqual(['getSettings', 'saveSettings', 'testProxy']);
    expect(Object.keys(fixture.api!.app!)).toEqual(['relaunch']);
    expect(Object.keys(fixture.api!.host)).toEqual(['command']);
    // R13B: typed ledger and summary commands only; no file system, Key or generic invoke reaches the page.
    expect(Object.keys(fixture.api!.summary)).toEqual(['preview', 'generate', 'confirm']);
    expect(Object.keys(fixture.api!.usage)).toEqual(['getReport', 'exportCsv']);
    // R14: typed artifact commands only; a file export goes through Main's save dialog, never a path from the page.
    expect(Object.keys(fixture.api!.artifact!)).toEqual(['preview', 'generate', 'list', 'getVersion', 'adopt', 'edit', 'export', 'listCodeCandidates']);
    // R15: a folder reference from Main's dialog, a read-only preview and a write of ticked files; never a path from the page.
    expect(Object.keys(fixture.api!.codeExport!)).toEqual(['chooseRoot', 'preview', 'write']);
    expect(fixture.api!.settings).not.toHaveProperty('resolveKey');
    fixture.invoke.mockResolvedValue({ version: 1, ok: true, data: [] });
    await fixture.api!.settings.listProviderSummaries();
    expect(fixture.invoke).toHaveBeenLastCalledWith('settings.listProviderSummaries', undefined);
    fixture.invoke.mockResolvedValue({ version: 1, ok: true, data: { mode: 'memory', backend: 'memory', persistent: false, message: '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' } });
    await fixture.api!.settings.getKeyStorageStatus();
    expect(fixture.invoke).toHaveBeenLastCalledWith('settings.getKeyStorageStatus', undefined);
  });

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
  it('rejects transport failures with a strict public DTO that crosses contextBridge without losing fields', async () => {
    fixture.invoke.mockRejectedValue(new Error('fixture-secret /private/internal/preload.cjs'));
    const error = await fixture.api!.run.getSnapshot('r').catch((error: unknown) => error);
    expect(apiErrorSchema.safeParse(error).success).toBe(true);
    expect(error).toStrictEqual({ code: 'transport_error', message: 'IPC connection failed', retryable: true });
    expect(error).not.toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('stack');
    expect(JSON.stringify(error)).not.toMatch(/fixture-secret|\bat\s|\.ts|\.cjs|\//);
  });
  it.each([
    ['invalid input', () => fixture.api!.run.getSnapshot(' '), undefined, { code: 'invalid_input', message: 'Invalid request parameters', retryable: false, field: 'arguments' }],
    ['malformed response', () => fixture.api!.run.getSnapshot('r'), { version: 2, ok: true, data: snapshot }, { code: 'invalid_response', message: 'Invalid response; refresh the run snapshot', retryable: false }],
    ['cross-run response', () => fixture.api!.run.getSnapshot('r'), { version: 1, ok: true, data: { ...snapshot, runId: 'other' } }, { code: 'invalid_response', message: 'Invalid response; refresh the run snapshot', retryable: false }],
    ['public error', () => fixture.api!.run.getSnapshot('r'), { version: 1, ok: false, error: { code: 'unsupported', message: 'This operation is not supported yet', retryable: false } }, { code: 'unsupported', message: 'This operation is not supported yet', retryable: false }],
    ['Key failure', () => fixture.api!.settings.setKey({ providerId: 'p', apiKey: 'fixture-secret' }), { version: 1, ok: false, error: { code: 'internal_error', message: 'Operation failed', retryable: false } }, { code: 'internal_error', message: 'Operation failed', retryable: false }],
  ] as const)('returns only a strict public DTO for %s', async (_case, request, response, expected) => {
    fixture.invoke.mockResolvedValue(response);
    const error = await request().catch((error: unknown) => error);
    expect(apiErrorSchema.safeParse(error).success).toBe(true);
    expect(error).toStrictEqual(expected);
    expect(error).not.toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('stack');
    expect(JSON.stringify(error)).not.toMatch(/fixture-secret|\bat\s|\.ts|\.cjs|\//);
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
