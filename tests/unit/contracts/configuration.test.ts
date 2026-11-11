import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import * as schemas from '../../../src/shared/schemas';
import * as configurationContracts from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';
import type {
  AgentInput, ProviderInput, RoomInput, RoomManagementApiContract, ProviderSettingsApiContract,
  RoomsFeatureProps, SettingsFeatureProps,
} from '../../../src/shared/contracts/configuration';

// Missing exports fail as assertions before the new configuration module exists.
function schema(name: string): z.ZodType {
  expect(schemas, `Shared must export ${name}`).toHaveProperty(name);
  return (schemas as unknown as Record<string, z.ZodType>)[name];
}

const timestamp = '2026-10-16T00:00:00.000Z';
const room = { id: 'room-1', name: 'Room', objective: '', kind: 'project', brief: '', defaultMode: 'group-chat', archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
const agent = {
  id: 'agent-1', roomId: 'room-1', displayName: 'Agent', roleTemplateId: 'critic', systemPrompt: '',
  providerId: null, modelId: null, enabled: true, displayOrder: 0,
  archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
};
const provider = {
  id: 'provider-1', name: 'Mock', kind: 'mock', baseUrl: null, enabled: true, isDefault: false,
  defaultModelId: null, customModels: [], keyReference: null, createdAt: timestamp, updatedAt: timestamp,
};
const secureStorage = { mode: 'secure', backend: 'fake-secure', persistent: true, message: '密钥将使用系统安全存储持久化。' };
const memoryStorage = { mode: 'memory', backend: 'memory', persistent: false, message: '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' };
const historyMessage = {
  id: 'message-1', roomId: 'room-1', runId: null, turnId: null, senderType: 'user', senderName: 'User',
  content: 'Question', status: 'completed', sortKey: 1, createdAt: timestamp, updatedAt: timestamp,
};
const run = { id: 'run-1', roomId: 'room-1', status: 'completed', task: null, createdAt: timestamp, updatedAt: timestamp };

describe('configuration inputs', () => {
  it('defaults safe provider options and trims its display name', () => {
    expect(schema('providerInputSchema').parse({ id: 'p', name: ' Mock ', kind: 'mock' })).toEqual({
      id: 'p', name: 'Mock', kind: 'mock', baseUrl: null, enabled: true, isDefault: false, defaultModelId: null, customModels: [],
    });
  });
  it('accepts the demo service, and a compatible one with an address or stopped', () => {
    for (const input of [{ kind: 'mock' }, { kind: 'compatible', baseUrl: 'https://service.example/v1' }, { kind: 'compatible', enabled: false }])
      expect(schema('providerInputSchema').safeParse({ id: 'p', name: 'Provider', ...input }).success).toBe(true);
    expect(schema('providerInputSchema').safeParse({ id: 'p', name: 'Provider', kind: 'compatible' }).success).toBe(false);
  });
  it.each([
    ['https://EXAMPLE.com:443/v1/', 'https://example.com/v1/'],
    [' http://LOCALHOST:8080/v1 ', 'http://localhost:8080/v1'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['http://[::1]:8080/v1', 'http://[::1]:8080/v1'],
  ])('normalizes an approved endpoint %s', (baseUrl, expected) => {
    expect(schema('providerInputSchema').parse({ id: 'p', name: 'Local', kind: 'compatible', baseUrl })).toMatchObject({ baseUrl: expected });
  });
  it.each([
    'http://example.com/v1', 'http://localhost.attacker/v1', 'http://127.1/v1', 'http://2130706433/v1',
    'http://0x7f000001/v1', 'http://127.000.000.001/v1', 'http://localhost./v1', 'http://[0:0:0:0:0:0:0:1]/v1',
    'https://user:password@example.com/v1', 'https://@example.com/v1', 'https://example.com/v1?token=fake',
    'https://example.com/v1?', 'https://example.com/v1#fragment', 'https://example.com/v1#', 'file:///tmp/provider', 'not-a-url',
  ])('rejects an unsafe or ambiguous endpoint %s', (baseUrl) => {
    expect(schema('providerInputSchema').safeParse({ id: 'p', name: 'Provider', kind: 'compatible', baseUrl }).success).toBe(false);
  });
  it('rejects Mock endpoints, unsupported kinds and credentials in ordinary configuration', () => {
    for (const input of [
      { id: 'p', name: 'Mock', kind: 'mock', baseUrl: 'https://example.com/' },
      { id: 'p', name: 'Provider', kind: 'unknown' },
      { id: 'p', name: 'Provider', kind: 'compatible', baseUrl: 'https://service.example/v1', apiKey: 'fixture-secret' },
      { id: 'p', name: 'Provider', kind: 'compatible', baseUrl: 'https://service.example/v1', customModels: [{ id: 'model-1', name: 'Model', apiKey: 'fixture-secret' }] },
    ]) expect(schema('providerInputSchema').safeParse(input).success).toBe(false);
    expect(schema('providerConfigurationSchema').safeParse({ ...provider, keyReference: { id: 'key-1', apiKey: 'fixture-secret' } }).success).toBe(false);
  });
  it('accepts provider output with a reference and preserves unknown legacy kind in summaries', () => {
    expect(schema('providerConfigurationSchema').parse({ ...provider, keyReference: { id: 'key-1' } })).toMatchObject({ keyReference: { id: 'key-1' } });
    expect(schema('providerSummarySchema').parse({
      id: 'legacy-provider', name: 'Legacy', kind: null, enabled: false, isDefault: false,
      defaultModelId: null, customModels: [], configurationValid: false, hasStoredKey: true,
    })).toMatchObject({ kind: null, configurationValid: false, hasStoredKey: true });
  });
  it('rejects a disabled provider as default on create, update and configuration output', () => {
    const input = { id: 'p', name: 'Mock', kind: 'mock', isDefault: true, enabled: false };
    expect(schema('providerInputSchema').safeParse(input).success).toBe(false);
    expect(schema('createProviderInputSchema').safeParse({ name: 'Mock', kind: 'mock', isDefault: true, enabled: false }).success).toBe(false);
    expect(schema('providerConfigurationSchema').safeParse({ ...provider, isDefault: true, enabled: false }).success).toBe(false);
  });
  it('defaults new rooms and allows explicitly unconfigured agents to be saved', () => {
    expect(schema('roomInputSchema').parse({ id: 'r', name: ' Room ' })).toEqual({ id: 'r', name: 'Room', objective: '' });
    expect(schema('agentInputSchema').parse({ id: 'a', roomId: 'r', displayName: ' Agent ', roleTemplateId: ' critic ' })).toEqual({
      id: 'a', roomId: 'r', displayName: 'Agent', roleTemplateId: 'critic', systemPrompt: '', providerId: null, modelId: null, enabled: true, displayOrder: 0,
    });
    expect(schema('roomConfigurationSchema').safeParse(room).success).toBe(true);
    expect(schema('agentConfigurationSchema').safeParse(agent).success).toBe(true);
  });
  it.each([
    { providerId: 'p', modelId: null }, { providerId: null, modelId: 'm' },
    { providerId: 'p', modelId: 'm', displayOrder: -1 }, { roleTemplateId: ' ' }, { displayName: ' ' },
  ])('rejects incomplete or malformed agent configuration %#', (invalid) => {
    expect(schema('agentInputSchema').safeParse({ id: 'a', roomId: 'r', displayName: 'Agent', roleTemplateId: 'critic', ...invalid }).success).toBe(false);
  });
  it('keeps create IDs under Main authority and rejects ordinary timestamps or key references as input', () => {
    for (const [name, input] of [
      ['createRoomInputSchema', { name: 'Room' }],
      ['createAgentInputSchema', { roomId: 'r', displayName: 'Agent', roleTemplateId: 'critic' }],
      ['createProviderInputSchema', { name: 'Mock', kind: 'mock' }],
    ] as const) {
      expect(schema(name).safeParse(input).success).toBe(true);
      expect(schema(name).safeParse({ ...input, id: 'renderer-chosen' }).success).toBe(false);
    }
    expect(schema('roomInputSchema').safeParse({ id: 'r', name: 'Room', createdAt: timestamp }).success).toBe(false);
    expect(schema('providerInputSchema').safeParse({ id: 'p', name: 'Provider', kind: 'mock', keyReference: { id: 'key' } }).success).toBe(false);
  });
  it('validates archive/list defaults and rejects duplicate reorder identities', () => {
    expect(schema('archiveConfigurationInputSchema').parse({ id: 'r' })).toEqual({ id: 'r', archived: true });
    expect(schema('listRoomsInputSchema').parse({})).toEqual({ includeArchived: false });
    expect(schema('listAgentConfigurationsInputSchema').parse({ roomId: 'r' })).toEqual({ roomId: 'r', includeArchived: false });
    expect(schema('reorderAgentsInputSchema').safeParse({ roomId: 'r', agentIds: ['a', 'a'] }).success).toBe(false);
    expect(schema('reorderAgentsInputSchema').safeParse({ roomId: 'r', agentIds: ['a', 'b'] }).success).toBe(true);
  });
});

describe('protected key and provider operations', () => {
  it('matches storage persistence and its controlled message to mode', () => {
    expect(schema('keyStorageStatusSchema').safeParse(secureStorage).success).toBe(true);
    expect(schema('keyStorageStatusSchema').safeParse(memoryStorage).success).toBe(true);
    for (const invalid of [
      { ...secureStorage, persistent: false }, { ...memoryStorage, persistent: true },
      { ...secureStorage, message: 'fixture-secret' }, { ...memoryStorage, apiKey: 'fixture-secret' },
    ]) expect(schema('keyStorageStatusSchema').safeParse(invalid).success).toBe(false);
  });
  it('distinguishes missing, durable, session and unavailable references', () => {
    for (const value of [
      { providerId: 'p', keyReference: null, state: 'missing', storage: memoryStorage },
      { providerId: 'p', keyReference: { id: 'k' }, state: 'configured', storage: secureStorage },
      { providerId: 'p', keyReference: { id: 'k' }, state: 'session', storage: memoryStorage },
      { providerId: 'p', keyReference: { id: 'k' }, state: 'unavailable', storage: memoryStorage },
    ]) expect(schema('providerKeyStateSchema').safeParse(value).success).toBe(true);
    for (const value of [
      { providerId: 'p', keyReference: { id: 'k' }, state: 'missing', storage: memoryStorage },
      { providerId: 'p', keyReference: null, state: 'configured', storage: secureStorage },
      { providerId: 'p', keyReference: { id: 'k' }, state: 'configured', storage: memoryStorage },
      { providerId: 'p', keyReference: { id: 'k' }, state: 'session', storage: secureStorage },
    ]) expect(schema('providerKeyStateSchema').safeParse(value).success).toBe(false);
  });
  it('accepts plaintext only in the dedicated set-key input', () => {
    expect(schema('setProviderKeyInputSchema').parse({ providerId: 'p', apiKey: 'fixture-secret' })).toEqual({ providerId: 'p', apiKey: 'fixture-secret' });
    expect(schema('setProviderKeyInputSchema').safeParse({ providerId: 'p', apiKey: '' }).success).toBe(false);
    expect(schema('providerKeyStateSchema').safeParse({ providerId: 'p', keyReference: null, state: 'missing', storage: memoryStorage, apiKey: 'fixture-secret' }).success).toBe(false);
  });
  it('uses Main request IDs only in results and preserves controlled adapter errors', () => {
    expect(schema('providerConnectionTestInputSchema').safeParse({ providerId: 'p', level: 'generation' }).success).toBe(false);
    expect(schema('providerConnectionTestInputSchema').safeParse({ providerId: 'p', level: 'generation', modelId: 'mock' }).success).toBe(true);
    expect(schema('providerConnectionTestInputSchema').safeParse({ providerId: 'p', level: 'configuration', requestId: 'renderer-id' }).success).toBe(false);
    const result = { providerId: 'p', result: { requestId: 'main-request', level: 'generation', ok: false, error: publicError('authentication_failed') } };
    expect(schema('providerConnectionTestResultSchema').safeParse(result).success).toBe(true);
    expect(schema('providerConnectionTestResultSchema').safeParse({ ...result, result: { ...result.result, error: { ...result.result.error, message: 'fixture-secret' } } }).success).toBe(false);
  });
});

describe('room history paging', () => {
  it('binds message cursors to a room and an ordered fixed upper bound', () => {
    const cursor = { roomId: 'room-1', afterKey: 1, throughKey: 5 };
    expect(schema('roomMessagePageInputSchema').parse({ roomId: 'room-1' })).toEqual({ roomId: 'room-1', limit: 100 });
    expect(schema('roomMessagePageInputSchema').safeParse({ roomId: 'room-1', cursor, limit: 500 }).success).toBe(true);
    for (const invalid of [
      { roomId: 'room-2', cursor }, { roomId: 'room-1', cursor: { ...cursor, afterKey: 6 } },
      { roomId: 'room-1', cursor: { ...cursor, afterKey: -1 } }, { roomId: 'room-1', limit: 0 }, { roomId: 'room-1', limit: 501 },
    ]) expect(schema('roomMessagePageInputSchema').safeParse(invalid).success).toBe(false);
  });
  it('keeps nullable legacy message identities, status and stable sort keys explicit', () => {
    expect(schema('historyMessageSchema').safeParse(historyMessage).success).toBe(true);
    for (const invalid of [{ sortKey: 0 }, { sortKey: 1.5 }, { status: 'unknown' }, { runId: undefined }, { turnId: undefined }]) {
      expect(schema('historyMessageSchema').safeParse({ ...historyMessage, ...invalid }).success).toBe(false);
    }
  });
  it('rejects mixed rooms, duplicate sort keys and a missing continuation cursor', () => {
    const nextCursor = { roomId: 'room-1', afterKey: 2, throughKey: 5 };
    const items = [historyMessage, { ...historyMessage, id: 'message-2', sortKey: 2 }];
    expect(schema('roomMessagePageSchema').safeParse({ items, nextCursor, hasMore: true }).success).toBe(true);
    expect(schema('roomMessagePageSchema').safeParse({ items: [], nextCursor: null, hasMore: false }).success).toBe(true);
    for (const invalid of [
      { items, nextCursor: null, hasMore: true },
      { items: [historyMessage, { ...items[1], roomId: 'room-2' }], nextCursor, hasMore: true },
      { items: [historyMessage, { ...items[1], sortKey: 1 }], nextCursor, hasMore: true },
      { items, nextCursor: { ...nextCursor, roomId: 'room-2' }, hasMore: true },
    ]) expect(schema('roomMessagePageSchema').safeParse(invalid).success).toBe(false);
  });
  it('orders run history by createdAt then id with room-bound cursors', () => {
    const cursor = { roomId: 'room-1', throughRowId: 9, after: { createdAt: timestamp, id: 'run-1' }, through: { createdAt: timestamp, id: 'run-9' } };
    expect(schema('roomRunPageInputSchema').parse({ roomId: 'room-1' })).toEqual({ roomId: 'room-1', limit: 100 });
    expect(schema('roomRunPageInputSchema').safeParse({ roomId: 'room-1', cursor }).success).toBe(true);
    expect(schema('roomRunPageInputSchema').safeParse({ roomId: 'room-2', cursor }).success).toBe(false);
    expect(schema('roomRunPageInputSchema').safeParse({ roomId: 'room-1', cursor: { ...cursor, after: { createdAt: timestamp, id: 'run-z' } } }).success).toBe(false);
    expect(schema('runSummarySchema').safeParse(run).success).toBe(true);
    expect(schema('runSummarySchema').safeParse({ ...run, status: 'unknown' }).success).toBe(false);
    const items = [run, { ...run, id: 'run-2' }];
    const nextCursor = { ...cursor, after: { createdAt: timestamp, id: 'run-2' } };
    expect(schema('roomRunPageSchema').safeParse({ items, nextCursor, hasMore: true }).success).toBe(true);
    expect(schema('roomRunPageSchema').safeParse({ items: [items[1], items[0]], nextCursor, hasMore: true }).success).toBe(false);
    expect(schema('roomRunPageSchema').safeParse({ items, nextCursor: null, hasMore: true }).success).toBe(false);
  });
});

it('maps every candidate room and provider operation to executable input and output schemas', () => {
  expect(configurationContracts).toHaveProperty('roomManagementContracts');
  expect(configurationContracts).toHaveProperty('providerSettingsContracts');
  const { roomManagementContracts: rooms, providerSettingsContracts: settings } = configurationContracts;
  for (const [method, input, output] of [
    ['createRoom', { name: 'Room' }, room], ['updateRoom', { id: 'room-1', name: 'Room' }, room],
    ['getRoomConfiguration', { id: 'room-1' }, room], ['listRooms', undefined, [room]],
    ['archiveRoom', { id: 'room-1' }, room], ['deleteRoom', { id: 'room-1' }, undefined],
    ['createAgent', { roomId: 'room-1', displayName: 'Agent', roleTemplateId: 'critic' }, agent],
    ['updateAgent', { id: 'agent-1', roomId: 'room-1', displayName: 'Agent', roleTemplateId: 'critic' }, agent],
    ['getAgentConfiguration', { id: 'agent-1' }, agent], ['listAgentConfigurations', { roomId: 'room-1' }, [agent]],
    ['reorderAgents', { roomId: 'room-1', agentIds: ['agent-1'] }, [agent]], ['archiveAgent', { id: 'agent-1' }, agent],
    ['deleteAgent', { id: 'agent-1' }, undefined],
    ['listRoomMessages', { roomId: 'room-1' }, { items: [historyMessage], nextCursor: null, hasMore: false }],
    ['listRoomRuns', { roomId: 'room-1' }, { items: [run], nextCursor: null, hasMore: false }],
    // D167: the lineup, a new 独立讨论, and the list of them.
    ['getLineup', undefined, { ...room, id: 'roundtable-lineup', kind: 'lineup' }],
    ['createStandalone', { fromRoomId: 'room-2', fallbackModel: { providerId: 'p', modelId: 'm' } }, { ...room, kind: 'standalone' }],
    ['listStandalone', { includeArchived: true }, [{ room: { ...room, kind: 'standalone' }, run, members: ['林舟', '阿哲'] }]],
  ] as const) {
    expect(rooms[method].input.safeParse(input).success, `${method} input`).toBe(true);
    expect(rooms[method].output.safeParse(output).success, `${method} output`).toBe(true);
    expect(rooms[method].input.safeParse({ apiKey: 'fixture-secret' }).success, `${method} credential rejection`).toBe(false);
  }
  for (const [method, input, output] of [
    ['createProvider', { name: 'Mock', kind: 'mock' }, provider], ['updateProvider', { id: 'provider-1', name: 'Mock', kind: 'mock' }, provider],
    ['getProviderConfiguration', { id: 'provider-1' }, provider],
    ['listProviderSummaries', undefined, [{ id: 'provider-1', name: 'Mock', kind: 'mock', enabled: true, isDefault: false, defaultModelId: null, customModels: [], configurationValid: true, hasStoredKey: false }]],
    ['deleteProvider', { id: 'provider-1' }, undefined],
    ['setKey', { providerId: 'provider-1', apiKey: 'fixture-secret' }, { providerId: 'provider-1', keyReference: { id: 'k' }, state: 'session', storage: memoryStorage }],
    ['deleteKey', { providerId: 'provider-1' }, undefined],
    ['getProviderKeyState', { providerId: 'provider-1' }, { providerId: 'provider-1', keyReference: null, state: 'missing', storage: memoryStorage }],
    ['getKeyStorageStatus', undefined, memoryStorage],
    ['testConnection', { providerId: 'provider-1', level: 'configuration' }, { providerId: 'provider-1', result: { requestId: 'main-request', level: 'configuration', ok: true } }],
  ] as const) {
    expect(settings[method].input.safeParse(input).success, `${method} input`).toBe(true);
    expect(settings[method].output.safeParse(output).success, `${method} output`).toBe(true);
    expect(settings[method].output.safeParse({ apiKey: 'fixture-secret' }).success, `${method} credential rejection`).toBe(false);
  }
  expectTypeOf<{ id: string; name: string }>().toMatchTypeOf<RoomInput>();
  expectTypeOf<{ id: string; name: string; kind: 'mock' }>().toMatchTypeOf<ProviderInput>();
  expectTypeOf<{ id: string; roomId: string; displayName: string; roleTemplateId: string }>().toMatchTypeOf<AgentInput>();
  expectTypeOf<RoomsFeatureProps['api']>().toEqualTypeOf<RoomManagementApiContract>();
  expectTypeOf<SettingsFeatureProps['api']>().toEqualTypeOf<ProviderSettingsApiContract>();
  expectTypeOf<RoomsFeatureProps['onSelectRoom']>().toEqualTypeOf<(roomId: string) => void>();
  expectTypeOf<RoomsFeatureProps['onSelectRun']>().toEqualTypeOf<(runId: string) => void>();
  expectTypeOf<SettingsFeatureProps['onClose']>().toEqualTypeOf<() => void>();
});

it('rejects partial Provider/Model selection on create as well as update, while preserving legacy output', () => {
  for (const input of [{ providerId: 'p' }, { modelId: 'mock' }]) {
    expect(schemas.createAgentInputSchema.safeParse({ roomId: 'r', displayName: 'A', roleTemplateId: 'draft', ...input }).success).toBe(false);
  }
  expect(schemas.agentConfigurationSchema.safeParse({ ...agent, providerId: null, modelId: 'mock' }).success).toBe(true);
});

it('rejects continuation cursors that skip persisted items or cannot advance', () => {
  const cursor = {roomId: 'room-1', afterKey: 4, throughKey: 5};
  expect(schemas.roomMessagePageSchema.safeParse({items:[historyMessage],nextCursor:cursor,hasMore:true}).success).toBe(false);
  expect(schemas.roomMessagePageSchema.safeParse({items:[],nextCursor:cursor,hasMore:true}).success).toBe(false);
  const nextCursor = {roomId:'room-1',throughRowId:9,after:{createdAt:timestamp,id:'run-8'},through:{createdAt:timestamp,id:'run-9'}};
  expect(schemas.roomRunPageSchema.safeParse({items:[run],nextCursor,hasMore:true}).success).toBe(false);
});
