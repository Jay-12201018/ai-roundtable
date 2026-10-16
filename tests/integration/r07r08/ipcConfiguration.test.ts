// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { RoundtableApiContract } from '../../../src/shared/contracts/app';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { ProviderSettingsService } from '../../../src/main/settings';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { registerIpc } from '../../../src/main/ipc/registerIpc';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trusted: true,
  api: undefined as RoundtableApiContract | undefined,
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => fixture.handlers.set(channel, handler),
    removeHandler: (channel: string) => fixture.handlers.delete(channel),
  },
  contextBridge: { exposeInMainWorld: (_name: string, api: RoundtableApiContract) => { fixture.api = api; } },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise.resolve().then(() => fixture.handlers.get(channel)!({}, ...args)),
    on: () => {}, removeListener: () => {},
  },
}));
vi.mock('../../../src/main/windows/createMainWindow', () => ({
  isTrustedIpcSender: () => fixture.trusted,
  isTrustedRenderer: () => fixture.trusted,
}));
import '../../../src/preload';

let database: Database;
let keys: KeyService;
let settings: ProviderSettingsService;
let dispose: ReturnType<typeof registerIpc>;
beforeEach(() => {
  fixture.trusted = true;
  database = new Database(':memory:'); database.initialize();
  keys = new KeyService(database, createMemoryKeyBackend());
  settings = new ProviderSettingsService(database, keys);
  dispose = registerIpc({ webContents: { send: () => {} } } as unknown as BrowserWindow, {
    run: new RunService(database, new MockProvider()), rooms: new RoomService(database), settings,
  });
});
afterEach(async () => { dispose(); await dispose.drain(); database.close(); vi.restoreAllMocks(); });
const invoke = (channel: string, ...args: unknown[]) => fixture.handlers.get(channel)!({}, ...args);
function editable(provider: Awaited<ReturnType<ProviderSettingsService['createProvider']>>) {
  const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...input } = provider;
  return input;
}

describe('production configuration IPC and Preload with actual services', () => {
  it('persists settings and members through the restricted bridge', async () => {
    expect(fixture.api).toHaveProperty('rooms.createRoom');
    expect(fixture.api).toHaveProperty('settings.createProvider');
    const api = fixture.api!;
    const provider = await api.settings.createProvider({ name: 'Offline', kind: 'mock', isDefault: true });
    const room = await api.rooms.createRoom({ name: 'Room' });
    expect(await api.rooms.updateRoom({ id: room.id, name: 'Renamed', objective: 'Discuss' })).toMatchObject({ id: room.id, name: 'Renamed', objective: 'Discuss' });
    expect(await api.rooms.getRoomConfiguration({ id: room.id })).toMatchObject({ name: 'Renamed' });
    expect(await api.rooms.archiveRoom({ id: room.id })).toMatchObject({ archivedAt: expect.any(String) });
    expect(await api.rooms.listRooms()).toEqual([]);
    await api.rooms.archiveRoom({ id: room.id, archived: false });
    const agent = await api.rooms.createAgent({ roomId: room.id, displayName: 'Agent', roleTemplateId: 'draft', providerId: provider.id, modelId: 'mock' });
    expect(await api.rooms.listRooms()).toMatchObject([{ id: room.id, objective: 'Discuss' }]);
    expect(await api.rooms.updateAgent({ id: agent.id, roomId: room.id, displayName: 'Edited', roleTemplateId: 'review', providerId: provider.id, modelId: 'mock' })).toMatchObject({ id: agent.id, roleTemplateId: 'review' });
    expect(await api.rooms.getAgentConfiguration({ id: agent.id })).toMatchObject({ displayName: 'Edited' });
    expect(await api.rooms.reorderAgents({ roomId: room.id, agentIds: [agent.id] })).toMatchObject([{ id: agent.id, displayOrder: 0 }]);
    expect(await api.rooms.archiveAgent({ id: agent.id })).toMatchObject({ archivedAt: expect.any(String) });
    await api.rooms.archiveAgent({ id: agent.id, archived: false });
    expect(await api.rooms.listAgentConfigurations({ roomId: room.id })).toMatchObject([{ id: agent.id, providerId: provider.id, modelId: 'mock' }]);
    expect(database.getAgentConfiguration(agent.id)).toMatchObject({ roomId: room.id, providerId: provider.id });
    await expect(api.settings.deleteProvider({ id: provider.id })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await api.rooms.listRoomMessages({ roomId: room.id })).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(await api.rooms.listRoomRuns({ roomId: room.id })).toEqual({ items: [], hasMore: false, nextCursor: null });
    await api.rooms.deleteAgent({ id: agent.id });
    await api.settings.deleteProvider({ id: provider.id });
    await api.rooms.deleteRoom({ id: room.id });
    expect(await api.settings.listProviderSummaries()).toEqual([]);
    expect(await api.rooms.listRooms()).toEqual([]);
  });

  it('revokes fake session Keys across replacement, target change and deletion without leaking ordinary outputs', async () => {
    const api = fixture.api!;
    const provider = await api.settings.createProvider({ name: 'Target', kind: 'openai-compatible', baseUrl: 'https://one.example/v1' });
    const other = await api.settings.createProvider({ name: 'Other', kind: 'openai' });
    const first = await api.settings.setKey({ providerId: provider.id, apiKey: 'fixture-r78-first' });
    const second = await api.settings.setKey({ providerId: provider.id, apiKey: 'fixture-r78-second' });
    expect(first.state).toBe('session'); expect(second.state).toBe('session');
    expect(await keys.resolveKey(provider.id, first.keyReference!)).toBeUndefined();
    expect(await keys.resolveKey(other.id, second.keyReference!)).toBeUndefined();
    const configuration = await api.settings.getProviderConfiguration({ id: provider.id });
    expect(configuration.keyReference).toBeNull();
    expect(database.rawKeyRecord(second.keyReference!.id)).toBeUndefined();
    expect(JSON.stringify([first, second, configuration, await api.settings.listProviderSummaries(), await api.settings.getKeyStorageStatus()])).not.toContain('fixture-r78-');
    await api.settings.updateProvider({ ...editable(configuration), baseUrl: 'https://two.example/v1' });
    expect(await api.settings.getProviderKeyState({ providerId: provider.id })).toMatchObject({ state: 'missing', keyReference: null });
    expect(await keys.resolveKey(provider.id, second.keyReference!)).toBeUndefined();
    await api.settings.setKey({ providerId: provider.id, apiKey: 'fixture-r78-third' });
    await api.settings.deleteKey({ providerId: provider.id });
    expect(await api.settings.getProviderKeyState({ providerId: provider.id })).toMatchObject({ state: 'missing' });
    expect(await new KeyService(database, createMemoryKeyBackend()).getProviderKeyState(provider.id)).toMatchObject({ state: 'missing' });
  });

  it('keeps explicit Mock testing separate from unsupported real authentication and generation', async () => {
    const api = fixture.api!;
    const mock = await api.settings.createProvider({ name: 'Mock', kind: 'mock' });
    expect(await api.settings.listModels({ providerId: mock.id })).toEqual({ providerId: mock.id, models: [{ id: 'mock', name: 'Mock' }] });
    expect(await api.settings.testConnection({ providerId: mock.id, level: 'generation', modelId: 'mock' })).toMatchObject({ providerId: mock.id, result: { ok: true, level: 'generation' } });
    const real = await api.settings.createProvider({ name: 'Real', kind: 'openai' });
    await expect(api.settings.listModels({ providerId: real.id })).rejects.toMatchObject({ code: 'unsupported' });
    for (const level of ['authentication', 'generation'] as const) {
      expect(await api.settings.testConnection({ providerId: real.id, level, ...(level === 'generation' ? { modelId: 'custom' } : {}) })).toMatchObject({ providerId: real.id, result: { level, ok: false, error: { code: 'unsupported' } } });
    }
  });

  it('rejects unsafe inputs before mutation and keeps secrets out of errors and logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = 'fixture-r78-do-not-echo';
    expect(await invoke('settings.createProvider', { name: 'Bad', kind: 'openai', apiKey: secret })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await invoke('settings.listProviderSummaries')).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await invoke('settings.listProviderSummaries', undefined, secret)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const error = await invoke('settings.setKey', { providerId: 'missing', apiKey: secret });
    expect(error).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(await fixture.api!.settings.listProviderSummaries()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('drains a started Key encryption before shutdown can close the database', async () => {
    let release!: () => void;
    let started!: () => void;
    const encrypting = new Promise<void>(resolve => { started = resolve; });
    keys = new KeyService(database, {
      mode: 'secure', backend: 'fixture-secure', persistent: true,
      async encrypt() { started(); await new Promise<void>(resolve => { release = resolve; }); return 'fixture-ciphertext'; },
      async decrypt() { return 'fixture-r78-drain-key'; },
    });
    settings = new ProviderSettingsService(database, keys);
    dispose();
    dispose = registerIpc({ webContents: { send: () => {} } } as unknown as BrowserWindow, {
      run: new RunService(database, new MockProvider()), rooms: new RoomService(database), settings,
    });
    const provider = await settings.createProvider({ name: 'Delayed', kind: 'openai' });
    const pending = fixture.api!.settings.setKey({ providerId: provider.id, apiKey: 'fixture-r78-drain-key' }).catch(error => error);
    await encrypting;
    dispose();
    let drained = false;
    const drain = dispose.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await drain;
    expect(await pending).toMatchObject({ code: 'transport_error' });
    const reference = database.getProviderConfiguration(provider.id)!.keyReference!;
    expect(database.rawKeyRecord(reference.id)).toMatchObject({ providerId: provider.id, encryptedValue: 'fixture-ciphertext' });
    expect(JSON.stringify(database.rawKeyRecord(reference.id))).not.toContain('fixture-r78-drain-key');
  });

  it('does not roll back a committed mutation when the caller navigates before its result returns', async () => {
    const original = settings.createProvider.bind(settings);
    let release!: () => void;
    let committed!: () => void;
    const ready = new Promise<void>(resolve => { committed = resolve; });
    vi.spyOn(settings, 'createProvider').mockImplementationOnce(async input => {
      const provider = await original(input);
      committed();
      await new Promise<void>(resolve => { release = resolve; });
      return provider;
    });
    const pending = fixture.api!.settings.createProvider({ name: 'Committed', kind: 'mock' });
    await ready;
    fixture.trusted = false;
    release();
    await expect(pending).rejects.toMatchObject({ code: 'transport_error' });
    expect(database.listProviderSummaries()).toMatchObject([{ name: 'Committed' }]);
  });

  it.each([
    ['navigation', 'success'], ['disposal', 'success'], ['replacement', 'success'],
    ['navigation', 'failure'], ['disposal', 'failure'], ['replacement', 'failure'],
  ] as const)('withholds a delayed result after %s (%s)', async (change, outcome) => {
    const provider = await settings.createProvider({ name: 'P', kind: 'openai' });
    let resolve!: (value: typeof provider) => void;
    let reject!: (error: Error) => void;
    vi.spyOn(settings, 'getProviderConfiguration').mockImplementationOnce(() => new Promise((release, fail) => { resolve = release; reject = fail; }));
    const pending = fixture.api!.settings.getProviderConfiguration({ id: provider.id });
    await Promise.resolve();
    if (change === 'navigation') fixture.trusted = false;
    else if (change === 'disposal') dispose();
    else dispose = registerIpc({ webContents: { send: () => {} } } as unknown as BrowserWindow, {
      run: new RunService(database, new MockProvider()), rooms: new RoomService(database), settings,
    });
    if (outcome === 'success') resolve(provider); else reject(new Error('fixture-private-backend-error'));
    await expect(pending).rejects.toMatchObject({ code: 'transport_error', message: 'IPC connection failed' });
  });
});
