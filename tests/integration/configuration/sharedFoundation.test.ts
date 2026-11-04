// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { parseDiscussion } from '../../unit/context/discussion';

const databases: Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.useRealTimers(); });
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createRoom({ id: 'r', name: 'Roundtable', objective: 'Original' });
  db.createProvider({ id: 'p', name: 'Explicit Mock', kind: 'mock', defaultModelId: 'mock' });
  return db;
}
function member(db: Database, id = 'a', displayOrder = 0) {
  return db.createAgent({ id, roomId: 'r', displayName: id, roleTemplateId: 'reviewer', providerId: 'p', modelId: 'mock', displayOrder });
}
function frozenRun(db: Database, status = 'paused') {
  const a = db.getAgentConfiguration('a')!;
  db.insertRun({ id: 'run', roomId: 'r', status, workflowSnapshot: {}, task: 'Frozen', nextTurnIndex: 0, elapsedExecutionMs: 0,
    membersSnapshot: [{ agentId: a.id, displayName: a.displayName, roleTemplateId: a.roleTemplateId, systemPrompt: a.systemPrompt, providerId: a.providerId, modelId: a.modelId, displayOrder: a.displayOrder }] });
}

describe('shared Room / Agent / Provider persistence', () => {
  it('roundtrips configuration, stable identity, enabled state and transactional order', () => {
    const db = fixture(); member(db); member(db, 'b', 1);
    expect(db.updateRoom({ id: 'r', name: 'Renamed', objective: 'New' }).name).toBe('Renamed');
    db.updateAgent({ id: 'a', roomId: 'r', displayName: 'Updated', roleTemplateId: 'critic', providerId: 'p', modelId: 'mock', systemPrompt: 'Review', enabled: false, displayOrder: 0 });
    expect(db.listAgents('r').map(a => a.id)).toEqual(['b']);
    expect(db.reorderAgents('r', ['b', 'a']).map(a => a.id)).toEqual(['b', 'a']);
    expect(() => db.reorderAgents('r', ['a', 'a'])).toThrow();
    expect(db.listAgentConfigurations('r').map(a => a.id)).toEqual(['b', 'a']);
    expect(db.getAgentConfiguration('a')).toMatchObject({ systemPrompt: 'Review', enabled: false });
  });
  it('rejects dangling and cross-room selections and never sends an unconfigured new member to Mock', async () => {
    const db = fixture();
    expect(() => db.createAgent({ id: 'bad', roomId: 'r', displayName: 'Bad', roleTemplateId: 'draft', providerId: 'missing', modelId: 'mock' })).toThrow();
    db.createAgent({ id: 'empty', roomId: 'r', displayName: 'Empty', roleTemplateId: 'draft' });
    const provider = new MockProvider({ tokenDelayMs: 0 }); const stream = vi.spyOn(provider, 'streamChat');
    const service = new RunService(db, provider, createPublicMessagesBuilder());
    await expect(service.start({ roomId: 'r', task: 'Must reject', workflowSnapshot: {} })).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled(); expect(db.listRoomRuns({ roomId: 'r' }).items).toEqual([]);
    expect(() => db.updateAgent({ id: 'empty', roomId: 'other', displayName: 'X', roleTemplateId: 'draft' })).toThrow();
  });
  it('preserves a future frozen member without a Turn and keeps edits out of old snapshots', () => {
    const db = fixture(); member(db); frozenRun(db, 'interrupted');
    expect(() => db.deleteAgent('a')).toThrow();
    db.updateAgent({ id: 'a', roomId: 'r', displayName: 'New name', roleTemplateId: 'new role', providerId: 'p', modelId: 'mock' });
    db.archiveAgent('a');
    expect(db.listAgents('r')).toEqual([]);
    expect(db.getRun('run')?.membersSnapshot?.[0]).toMatchObject({ displayName: 'a', roleTemplateId: 'reviewer' });
    expect(() => db.deleteRoom('r')).toThrow();
  });
  it('allows explicit deletion only for unused objects and prevents stale Provider references', () => {
    const db = fixture(); member(db);
    expect(() => db.deleteProvider('p')).toThrow();
    db.deleteAgent('a'); db.deleteProvider('p'); db.deleteRoom('r');
    expect(db.listRooms()).toEqual([]); expect(db.listProviderSummaries()).toEqual([]);
  });
  it('keeps one enabled default Provider and scopes identical model names by instance', () => {
    const db = fixture();
    db.createProvider({ id: 'x', name: 'X', kind: 'compatible', baseUrl: 'https://example.test/v1', defaultModelId: 'same', isDefault: true });
    db.createProvider({ id: 'y', name: 'Y', kind: 'compatible', baseUrl: 'http://127.0.0.1:8080/v1', defaultModelId: 'same', isDefault: true });
    expect(db.listProviderSummaries().filter(p => p.isDefault).map(p => p.id)).toEqual(['y']);
    expect(db.validateModelSelection('x', 'same').id).toBe('x');
    expect(db.validateModelSelection('y', 'same').id).toBe('y');
    expect(() => db.updateProvider({ id: 'y', name: 'Y', kind: 'compatible', enabled: false, isDefault: true })).toThrow();
  });
  it('checks active frozen Provider references even after current Agent is rebound', () => {
    const db = fixture(); member(db); frozenRun(db);
    db.createProvider({ id: 'other', name: 'Other', kind: 'mock' });
    db.updateAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'review', providerId: 'other', modelId: 'mock' });
    expect(() => db.updateProvider({ id: 'p', name: 'Changed', kind: 'mock' })).toThrow();
    expect(() => db.deleteProvider('p')).toThrow();
    expect(() => db.archiveRoom('r')).toThrow();
  });
  it('executes explicitly configured three Mock Agents through existing context and persistence', async () => {
    const db = fixture(); member(db); member(db, 'b', 1); member(db, 'c', 2);
    const provider = new MockProvider({ tokenDelayMs: 0 }); const stream = vi.spyOn(provider, 'streamChat');
    const service = new RunService(db, provider, createPublicMessagesBuilder());
    const run = await service.start({ roomId: 'r', task: 'Shared task', workflowSnapshot: {}, maxTurns: 3 }); await service.waitForIdle(run.runId);
    expect(db.getRun(run.runId)?.status).toBe('completed'); expect(db.listAttempts(run.runId)).toHaveLength(3);
    // D095: the second member sees the first member's reply as quoted discussion, never as its own assistant turn.
    expect(stream.mock.calls[1][0].messages.some(m => m.role === 'assistant')).toBe(false);
    expect(parseDiscussion(stream.mock.calls[1][0].messages).entries).toEqual([expect.objectContaining({ role: 'user', own: false })]);
    expect(db.getRun(run.runId)?.membersSnapshot?.map(a => a.providerId)).toEqual(['p', 'p', 'p']);
  });
});

describe('room history keyset pagination', () => {
  it('bounds same-time message pages and rejects another room cursor while preserving all attempts', () => {
    const db = fixture(); member(db); frozenRun(db, 'completed');
    db.createRoom({ id: 'other', name: 'Other' });
    for (let i = 0; i < 5; i++) db.insertMessage({ id: `m${i}`, roomId: 'r', runId: 'run', senderType: 'agent', senderName: 'A', content: `${i}` });
    const page = db.listRoomMessages({ roomId: 'r', limit: 2 });
    expect(page.items.map(m => m.id)).toEqual(['m0', 'm1']); expect(page.hasMore).toBe(true);
    db.insertMessage({ id: 'late', roomId: 'r', runId: 'run', senderType: 'agent', senderName: 'A', content: 'late' });
    const p2 = db.listRoomMessages({ roomId: 'r', limit: 2, cursor: page.nextCursor! });
    const p3 = db.listRoomMessages({ roomId: 'r', limit: 2, cursor: p2.nextCursor! });
    expect([...page.items, ...p2.items, ...p3.items].map(m => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(p3.nextCursor).toBeNull(); expect(() => db.listRoomMessages({ roomId: 'other', cursor: page.nextCursor! })).toThrow();
    expect(db.listRoomMessages({ roomId: 'r' }).items.at(-1)?.id).toBe('late');
  });
  it('uses created time plus id for Run pages, unaffected by updated time or new Runs', () => {
    const db = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'));
    for (const id of ['a', 'b', 'c', 'd']) db.insertRun({ id, roomId: 'r', status: 'completed', workflowSnapshot: {} });
    const p1 = db.listRoomRuns({ roomId: 'r', limit: 2 });
    vi.setSystemTime(new Date('2026-10-17T00:00:00.000Z')); db.updateRun('a', { status: 'completed' });
    db.insertRun({ id: 'new', roomId: 'r', status: 'completed', workflowSnapshot: {} });
    const p2 = db.listRoomRuns({ roomId: 'r', limit: 2, cursor: p1.nextCursor! });
    expect([...p1.items, ...p2.items].map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(p2.items.every(r => r.task === null)).toBe(true); expect(p2.nextCursor).toBeNull();
  });
});

it('excludes Runs inserted at the same timestamp inside an existing paging window', () => {
  const db = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'));
  for (const id of ['a', 'b', 'c', 'd']) db.insertRun({ id, roomId: 'r', status: 'completed', workflowSnapshot: {} });
  const first = db.listRoomRuns({ roomId: 'r', limit: 2 });
  db.insertRun({ id: 'bb', roomId: 'r', status: 'completed', workflowSnapshot: {} });
  const second = db.listRoomRuns({ roomId: 'r', limit: 2, cursor: first.nextCursor! });
  expect([...first.items, ...second.items].map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
});

it('uses the same Unicode ID ordering as SQLite BINARY for same-time Run history', () => {
  const db = fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'));
  for (const id of ['\uE000', '😀']) db.insertRun({ id, roomId: 'r', status: 'completed', workflowSnapshot: {} });
  const first = db.listRoomRuns({ roomId: 'r', limit: 1 }); const second = db.listRoomRuns({ roomId: 'r', limit: 1, cursor: first.nextCursor! });
  expect([...first.items, ...second.items].map(r => r.id)).toEqual(['\uE000', '😀']);
});

it.each(['real-provider', 'disabled-provider'])('does not silently route %s configuration to Mock', async scenario => {
  const db = fixture(); member(db);
  if (scenario === 'real-provider') {
    db.createProvider({ id: 'real', name: 'Saved real configuration', kind: 'compatible', baseUrl: 'https://service.example/v1' });
    db.updateAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: 'real', modelId: 'mock' });
  } else db.updateProvider({ id: 'p', name: 'Disabled', kind: 'mock', enabled: false });
  const provider = new MockProvider({ tokenDelayMs: 0 }); const stream = vi.spyOn(provider, 'streamChat');
  const service = new RunService(db, provider, createPublicMessagesBuilder());
  await expect(service.start({ roomId: 'r', task: 'No fallback', workflowSnapshot: {} })).rejects.toThrow();
  expect(stream).not.toHaveBeenCalled(); expect(db.listRoomRuns({ roomId: 'r' }).items).toEqual([]);
});
