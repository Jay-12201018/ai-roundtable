// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import type { AgentConfiguration } from '../../../src/shared/contracts/configuration';

const databases: Database[] = []; const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); databases.splice(0).forEach(db => db.close()); directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function open(path = ':memory:') {
  const db = new Database(path); db.initialize(); databases.push(db);
  return { db, rooms: new RoomService(db) };
}
async function fixture(path?: string) {
  const f = open(path); const room = await f.rooms.createRoom({ name: '设计评审', objective: '持久目标' });
  f.db.createProvider({ id: 'mock-explicit', name: '本地 Mock', kind: 'mock', defaultModelId: 'mock' });
  const agents: AgentConfiguration[] = [];
  for (const [i, role] of ['Drafter', 'Critic', 'Synthesizer'].entries()) agents.push(await f.rooms.createAgent({ roomId: room.id, displayName: ['构思员', '质询员', '整合员'][i], roleTemplateId: role, systemPrompt: `角色指令 ${i}`, providerId: 'mock-explicit', modelId: 'mock', displayOrder: i }));
  const provider = new MockProvider({ tokenDelayMs: 0 });
  const runs = new RunService(f.db, provider, createPublicMessagesBuilder());
  return { ...f, room, agents, provider, runs };
}
function input(a: AgentConfiguration) {
  const { archivedAt: _a, createdAt: _c, updatedAt: _u, ...value } = a; return value;
}
function frozen(a: AgentConfiguration) {
  return { agentId: a.id, displayName: a.displayName, roleTemplateId: a.roleTemplateId, systemPrompt: a.systemPrompt, providerId: a.providerId, modelId: a.modelId, displayOrder: a.displayOrder };
}

describe('R07 persistence and protected configuration', () => {
  it('restores edited rooms, members, ordering and archives after actual database close/reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r07-reopen-')); directories.push(dir); const path = join(dir, 'rooms.sqlite');
    const f = await fixture(path);
    await f.rooms.updateRoom({ id: f.room.id, name: '已编辑', objective: '新目标' });
    await f.rooms.updateAgent({ ...input(f.agents[0]), displayName: '已修改成员', roleTemplateId: '新角色', systemPrompt: '新的提示', enabled: false });
    await f.rooms.reorderAgents({ roomId: f.room.id, agentIds: f.agents.map(a => a.id).reverse() });
    await f.rooms.archiveAgent({ id: f.agents[1].id }); await f.rooms.archiveRoom({ id: f.room.id });
    f.db.close(); const second = open(path);
    expect(await second.rooms.listRooms()).toEqual([]);
    expect(await second.rooms.listRooms({ includeArchived: true })).toEqual([expect.objectContaining({ name: '已编辑', objective: '新目标', archivedAt: expect.any(String) })]);
    expect((await second.rooms.listAgentConfigurations({ roomId: f.room.id, includeArchived: true })).map(a => a.id)).toEqual(f.agents.map(a => a.id).reverse());
    expect(await second.rooms.getAgentConfiguration({ id: f.agents[0].id })).toMatchObject({ displayName: '已修改成员', roleTemplateId: '新角色', systemPrompt: '新的提示', enabled: false, displayOrder: 2 });
    await second.rooms.archiveRoom({ id: f.room.id, archived: false }); await second.rooms.archiveAgent({ id: f.agents[1].id, archived: false });
    const disposable = await second.rooms.createRoom({ name: '可删除' });
    const agent = await second.rooms.createAgent({ roomId: disposable.id, displayName: '无引用', roleTemplateId: 'draft' });
    await second.rooms.deleteAgent({ id: agent.id }); await second.rooms.deleteRoom({ id: disposable.id });
    second.db.close(); const third = open(path);
    expect(await third.rooms.listRooms()).toEqual([expect.objectContaining({ id: f.room.id, archivedAt: null })]);
  });
  it('runs three custom explicit Mock members and verifies actual shared input, attempts and immutable identities', async () => {
    const f = await fixture(); const calls = vi.spyOn(f.provider, 'streamChat');
    const run = await f.runs.start({ roomId: f.room.id, task: '设计一个可核验方案', workflowSnapshot: {}, maxTurns: 3 });
    await f.runs.waitForIdle(run.runId);
    expect(f.runs.getSnapshot(run.runId).status).toBe('completed'); expect(calls).toHaveBeenCalledTimes(3);
    const messages = (await f.rooms.listRoomMessages({ roomId: f.room.id })).items;
    expect(messages.map(m => m.senderName)).toEqual(f.agents.map(a => a.displayName));
    expect(calls.mock.calls[1][0].messages.some(m => m.role === 'assistant' && m.content.includes(messages[0].content))).toBe(true);
    expect(calls.mock.calls[2][0].messages.filter(m => m.role === 'assistant').map(m => m.content).join(' ')).toContain(messages[1].content);
    for (const [i, [request]] of calls.mock.calls.entries()) {
      expect(request.modelId).toBe('mock'); expect(request.agentRole).toBe(f.agents[i].roleTemplateId);
      const { signal: _signal, ...persisted } = request;
      expect(f.db.getAttempt(request.requestId)?.inputSnapshot).toEqual(persisted);
      expect(request.messages.some(m => m.role === 'system' && m.content.includes(f.agents[i].systemPrompt))).toBe(true);
    }
    const before = f.db.readRunSnapshot(run.runId);
    await f.rooms.updateAgent({ ...input(f.agents[0]), displayName: '未来姓名', roleTemplateId: '未来角色', enabled: false });
    await f.rooms.archiveAgent({ id: f.agents[2].id }); await f.rooms.reorderAgents({ roomId: f.room.id, agentIds: [f.agents[1].id, f.agents[0].id] });
    expect(f.db.readRunSnapshot(run.runId)).toEqual(before);
    expect((await f.rooms.listRoomMessages({ roomId: f.room.id })).items).toEqual(messages);
    await expect(f.rooms.deleteAgent({ id: f.agents[2].id })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(f.rooms.deleteRoom({ id: f.room.id })).rejects.toMatchObject({ code: 'invalid_state' });
    await f.runs.shutdown();
  });
  it('allows editing / archiving future paused members but resumes with the frozen roles, prompts and order', async () => {
    const f = await fixture(); const calls = vi.spyOn(f.provider, 'streamChat');
    const run = await f.runs.start({ roomId: f.room.id, task: '暂停快照', workflowSnapshot: {}, mode: 'step', maxTurns: 3 });
    await f.runs.waitForIdle(run.runId); expect(f.runs.getSnapshot(run.runId).status).toBe('paused');
    const snapshots = f.db.getRun(run.runId)?.membersSnapshot;
    await f.rooms.updateAgent({ ...input(f.agents[1]), displayName: '新身份', roleTemplateId: 'other', systemPrompt: '新配置', providerId: null, modelId: null, enabled: false });
    await f.rooms.archiveAgent({ id: f.agents[1].id });
    await expect(f.rooms.deleteAgent({ id: f.agents[1].id })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(f.rooms.archiveRoom({ id: f.room.id })).rejects.toMatchObject({ code: 'invalid_state' });
    await f.runs.resumeRun(run.runId); await f.runs.waitForIdle(run.runId);
    expect(f.runs.getSnapshot(run.runId).status).toBe('completed');
    expect(calls.mock.calls[1][0]).toMatchObject({ agentRole: 'Critic', modelId: 'mock' });
    expect(JSON.stringify(calls.mock.calls[1][0].messages)).toContain('角色指令 1');
    expect(JSON.stringify(calls.mock.calls[1][0].messages)).not.toContain('新配置');
    expect(f.db.getRun(run.runId)?.membersSnapshot).toEqual(snapshots);
    expect((await f.rooms.listRoomMessages({ roomId: f.room.id })).items.map(m => m.senderName)).toEqual(f.agents.map(a => a.displayName));
    await f.runs.shutdown();
  });
  it.each(['paused', 'interrupted', 'completed', 'error', 'cancelled'])('protects frozen future members of %s Runs without requiring a Turn', async status => {
    const f = await fixture();
    f.db.insertRun({ id: 'frozen', roomId: f.room.id, status, workflowSnapshot: {}, task: '保留', membersSnapshot: f.agents.map(frozen), nextTurnIndex: 0, elapsedExecutionMs: 0 });
    await f.rooms.archiveAgent({ id: f.agents[2].id });
    await expect(f.rooms.deleteAgent({ id: f.agents[2].id })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(f.db.getRun('frozen')?.membersSnapshot).toEqual(f.agents.map(frozen));
  });
  it('recovers an interrupted run using frozen future members after configuration archival', async () => {
    const f = await fixture();
    f.db.insertRun({ id: 'recover', roomId: f.room.id, status: 'interrupted', workflowSnapshot: {}, task: '可恢复', membersSnapshot: f.agents.map(frozen), nextTurnIndex: 0, elapsedExecutionMs: 0, maxTurns: 3 });
    for (const a of f.agents) await f.rooms.archiveAgent({ id: a.id });
    await f.runs.recoverInterruptedRun('recover', 'resume');
    expect(f.runs.getSnapshot('recover').status).toBe('completed'); expect(f.db.listTurns('recover')).toHaveLength(3);
    await f.runs.shutdown();
  });
  it.each(['empty', 'disabled', 'unconfigured', 'disabled-provider', 'real-provider', 'invalid-provider'])('refuses %s startup without any fallback Mock call or new Run', async scenario => {
    const f = await fixture(); const calls = vi.spyOn(f.provider, 'streamChat');
    if (scenario === 'disabled-provider') f.db.updateProvider({ id: 'mock-explicit', name: '禁用', kind: 'mock', enabled: false });
    else if (scenario === 'real-provider') {
      f.db.createProvider({ id: 'real', name: '真实配置', kind: 'openai' });
      for (const a of f.agents) await f.rooms.updateAgent({ ...input(a), providerId: 'real', modelId: 'custom-not-a-white-list' });
    } else if (scenario === 'invalid-provider') {
      // Corrupt a disposable fixture only, to exercise safe legacy-invalid handling.
      (f.db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db.prepare("UPDATE providers SET type='invalid' WHERE id='mock-explicit'").run();
    } else for (const a of f.agents) {
      if (scenario === 'empty') await f.rooms.deleteAgent({ id: a.id });
      else await f.rooms.updateAgent({ ...input(a), enabled: scenario !== 'disabled', ...(scenario === 'unconfigured' ? { providerId: null, modelId: null } : {}) });
    }
    await expect(f.runs.start({ roomId: f.room.id, task: '禁止静默回退', workflowSnapshot: {} })).rejects.toMatchObject({ code: scenario === 'real-provider' ? 'unsupported' : 'invalid_state' });
    expect(calls).not.toHaveBeenCalled(); expect((await f.rooms.listRoomRuns({ roomId: f.room.id })).items).toEqual([]);
    await f.runs.shutdown();
  });
});

describe('R07 stable history paging through RoomService', () => {
  it('pages same-time Runs without duplicates or newly inserted lower IDs and binds cursors to rooms', async () => {
    const { db, rooms } = open(); const room = await rooms.createRoom({ name: 'R' }); const other = await rooms.createRoom({ name: 'Other' });
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    for (const id of ['a', 'b', 'c', 'd', '\uE000', '😀']) db.insertRun({ id, roomId: room.id, status: 'completed', workflowSnapshot: {}, task: `任务 ${id}` });
    const first = await rooms.listRoomRuns({ roomId: room.id, limit: 2 });
    db.insertRun({ id: 'bb-late', roomId: room.id, status: 'completed', workflowSnapshot: {} });
    db.updateRun('a', { status: 'error' });
    const second = await rooms.listRoomRuns({ roomId: room.id, limit: 2, cursor: first.nextCursor! });
    const third = await rooms.listRoomRuns({ roomId: room.id, limit: 2, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items].map(r => r.id)).toEqual(['a', 'b', 'c', 'd', '\uE000', '😀']); expect(third.nextCursor).toBeNull();
    await expect(rooms.listRoomRuns({ roomId: other.id, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await rooms.listRoomRuns({ roomId: room.id })).items.map(r => r.id)).toContain('bb-late');
  });
  it('holds a fixed message window, preserves old identity and supports explicit refresh', async () => {
    const { db, rooms } = open(); const room = await rooms.createRoom({ name: 'R' }); const other = await rooms.createRoom({ name: 'Other' });
    db.insertRun({ id: 'messages-run', roomId: room.id, status: 'completed', workflowSnapshot: {} });
    for (let i = 0; i < 7; i++) db.insertMessage({ id: `m${i}`, roomId: room.id, runId: 'messages-run', senderType: 'agent', senderName: '当时姓名', content: `正文 ${i}` });
    const first = await rooms.listRoomMessages({ roomId: room.id, limit: 3 });
    db.insertMessage({ id: 'late', roomId: room.id, runId: 'messages-run', senderType: 'agent', senderName: '其他身份', content: '刷新后可见' });
    const second = await rooms.listRoomMessages({ roomId: room.id, limit: 3, cursor: first.nextCursor! });
    const third = await rooms.listRoomMessages({ roomId: room.id, limit: 3, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items].map(m => m.id)).toEqual(Array.from({ length: 7 }, (_, i) => `m${i}`));
    expect(third.hasMore).toBe(false); expect(third.nextCursor).toBeNull();
    await expect(rooms.listRoomMessages({ roomId: other.id, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await rooms.listRoomMessages({ roomId: room.id })).items.at(-1)?.content).toBe('刷新后可见');
  });
});
