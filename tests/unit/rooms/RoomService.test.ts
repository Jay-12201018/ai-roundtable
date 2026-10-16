// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { ContractError } from '../../../src/shared/contracts/errors';
import type { RoomManagementApiContract } from '../../../src/shared/contracts/configuration';

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  const service: RoomManagementApiContract = new RoomService(db);
  return { db, service };
}
describe('RoomService typed business boundary', () => {
  it('generates Main-owned identities and roundtrips room configuration', async () => {
    const { service } = setup();
    const room = await service.createRoom({ name: '  项目讨论  ', objective: '目标' });
    expect(room.id).toMatch(/^[\da-f-]{36}$/); expect(room.name).toBe('项目讨论');
    expect(await service.getRoomConfiguration({ id: room.id })).toEqual(room);
    expect(await service.updateRoom({ id: room.id, name: '新名称', objective: '新目标' })).toMatchObject({ id: room.id, name: '新名称', objective: '新目标' });
    expect(await service.listRooms()).toHaveLength(1);
    await service.archiveRoom({ id: room.id }); expect(await service.listRooms()).toEqual([]);
    expect(await service.listRooms({ includeArchived: true })).toHaveLength(1);
    await service.archiveRoom({ id: room.id, archived: false });
    await service.deleteRoom({ id: room.id }); expect(await service.listRooms()).toEqual([]);
  });
  it('creates, edits, orders, disables, archives and deletes unused members', async () => {
    const { db, service } = setup(); const room = await service.createRoom({ name: 'Room' });
    db.createProvider({ id: 'p', name: 'Explicit Mock', kind: 'mock' });
    const a = await service.createAgent({ roomId: room.id, displayName: 'A', roleTemplateId: 'Drafter', providerId: 'p', modelId: 'mock' });
    const b = await service.createAgent({ roomId: room.id, displayName: 'B', roleTemplateId: 'Critic', displayOrder: 1 });
    expect(a.id).not.toBe(b.id);
    await service.updateAgent({ id: a.id, roomId: room.id, displayName: '甲', roleTemplateId: '审查', systemPrompt: '检查证据', enabled: false, displayOrder: 0, providerId: 'p', modelId: 'mock' });
    expect(await service.getAgentConfiguration({ id: a.id })).toMatchObject({ displayName: '甲', enabled: false, systemPrompt: '检查证据' });
    expect((await service.reorderAgents({ roomId: room.id, agentIds: [b.id, a.id] })).map(a => a.displayOrder)).toEqual([0, 1]);
    await expect(service.reorderAgents({ roomId: room.id, agentIds: [a.id] })).rejects.toMatchObject({ code: 'invalid_input' });
    await service.archiveAgent({ id: a.id }); expect(await service.listAgentConfigurations({ roomId: room.id })).toHaveLength(1);
    expect(await service.listAgentConfigurations({ roomId: room.id, includeArchived: true })).toHaveLength(2);
    await service.archiveAgent({ id: a.id, archived: false });
    await service.deleteAgent({ id: a.id }); expect(await service.listAgentConfigurations({ roomId: room.id })).toEqual([expect.objectContaining({ id: b.id })]);
  });
  it.each(['getRoomConfiguration', 'getAgentConfiguration', 'deleteRoom', 'deleteAgent', 'archiveRoom', 'archiveAgent'] as const)('%s exposes not_found', async method => {
    const { service } = setup(); await expect(service[method]({ id: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
  });
  it.each([
    ['createRoom', { name: ' ' }], ['createRoom', { id: 'injected', name: 'X' }],
    ['createAgent', { roomId: 'r', displayName: 'A', roleTemplateId: 'x', providerId: 'p' }],
    ['listRooms', { includeArchived: 'yes' }], ['archiveRoom', { id: 'r', archived: 'yes' }],
    ['listRoomRuns', { roomId: 'r', limit: 0 }], ['listRoomMessages', { roomId: 'r', limit: 501 }],
    ['reorderAgents', { roomId: 'r', agentIds: ['a', 'a'] }],
  ] as const)('validates %s input without leaking internals', async (method, input) => {
    const { service } = setup();
    await expect((service[method] as (input: unknown) => Promise<unknown>)(input)).rejects.toMatchObject({ code: 'invalid_input', message: 'Invalid request parameters' });
  });
  it('rejects foreign / mock model references and keeps malformed updates atomic', async () => {
    const { db, service } = setup(); const r = await service.createRoom({ name: 'R' });
    const fields = { roomId: r.id, displayName: 'A', roleTemplateId: 'draft', providerId: 'missing', modelId: 'mock' };
    await expect(service.createAgent(fields)).rejects.toMatchObject({ code: 'not_found' });
    db.createProvider({ id: 'p', name: 'Mock', kind: 'mock' });
    await expect(service.createAgent({ ...fields, providerId: 'p', modelId: 'real' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await service.listAgentConfigurations({ roomId: r.id })).toEqual([]);
  });
  it('normalizes unexpected repository failures and rejects invalid output', async () => {
    const { db, service } = setup();
    vi.spyOn(db, 'listRooms').mockImplementationOnce(() => { throw new Error('/private/user.db secret'); });
    await expect(service.listRooms()).rejects.toEqual(new ContractError('internal_error'));
    vi.spyOn(db, 'listRooms').mockReturnValueOnce([{ id: 'bad' }] as never);
    await expect(service.listRooms()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
