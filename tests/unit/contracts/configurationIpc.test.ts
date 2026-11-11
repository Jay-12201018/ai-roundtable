import { describe, expect, it } from 'vitest';
import { parseIpcOutput } from '../../../src/shared/contracts/ipc';

const parse = parseIpcOutput as (channel: string, input: unknown, output: unknown) => unknown;
const timestamp = '2026-10-17T00:00:00.000Z';
const room = { id: 'r', name: 'Room', objective: '', kind: 'project', brief: '', defaultMode: 'group-chat', archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
const agent = { id: 'a', roomId: 'r', displayName: 'Agent', roleTemplateId: 'draft', systemPrompt: '', providerId: null, modelId: null, enabled: true, displayOrder: 0, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
const provider = { id: 'p', name: 'Provider', kind: 'compatible', baseUrl: 'https://service.example/v1', enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: null, createdAt: timestamp, updatedAt: timestamp };
const storage = { mode: 'memory', backend: 'memory', persistent: false, message: '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' };
const key = { providerId: 'p', state: 'missing', keyReference: null, storage };
const message = { id: 'm', roomId: 'r', runId: null, turnId: null, senderType: 'user', senderName: 'User', content: 'History', status: 'completed', sortKey: 6, createdAt: timestamp, updatedAt: timestamp };
const run = { id: 'run', roomId: 'r', status: 'completed', task: 'History', createdAt: timestamp, updatedAt: timestamp };

describe('configuration IPC response identity', () => {
  it.each([
    ['rooms.getRoomConfiguration', { id: 'r' }, room, { ...room, id: 'other' }],
    ['rooms.updateRoom', { id: 'r', name: 'Room' }, room, { ...room, id: 'other' }],
    ['rooms.archiveRoom', { id: 'r' }, room, { ...room, id: 'other' }],
    ['rooms.createAgent', { roomId: 'r', displayName: 'Agent', roleTemplateId: 'draft' }, agent, { ...agent, roomId: 'other' }],
    ['rooms.getAgentConfiguration', { id: 'a' }, agent, { ...agent, id: 'other' }],
    ['rooms.updateAgent', { id: 'a', roomId: 'r', displayName: 'Agent', roleTemplateId: 'draft' }, agent, { ...agent, roomId: 'other' }],
    ['rooms.archiveAgent', { id: 'a' }, agent, { ...agent, id: 'other' }],
    ['rooms.listAgentConfigurations', { roomId: 'r' }, [agent], [{ ...agent, roomId: 'other' }]],
    ['rooms.reorderAgents', { roomId: 'r', agentIds: ['a'] }, [agent], [{ ...agent, id: 'other' }]],
    ['settings.getProviderConfiguration', { id: 'p' }, provider, { ...provider, id: 'other' }],
    ['settings.updateProvider', { id: 'p', name: 'Provider', kind: 'compatible', baseUrl: 'https://service.example/v1' }, provider, { ...provider, id: 'other' }],
    ['settings.getProviderKeyState', { providerId: 'p' }, key, { ...key, providerId: 'other' }],
    ['settings.setKey', { providerId: 'p', apiKey: 'fixture-secret' }, key, { ...key, providerId: 'other' }],
    ['settings.testConnection', { providerId: 'p', level: 'configuration' }, { providerId: 'p', result: { requestId: 'request', level: 'configuration', ok: true } }, { providerId: 'other', result: { requestId: 'request', level: 'configuration', ok: true } }],
  ])('rejects %s output belonging to another requested entity', (channel, input, valid, wrong) => {
    expect(parse(channel as string, input, valid)).toEqual(valid);
    expect(() => parse(channel as string, input, wrong)).toThrow(expect.objectContaining({ code: 'invalid_response' }));
  });

  it('rejects a connection result from another test level', () => {
    expect(() => parse('settings.testConnection', { providerId: 'p', level: 'generation', modelId: 'm' }, { providerId: 'p', result: { requestId: 'request', level: 'configuration', ok: true } })).toThrow(expect.objectContaining({ code: 'invalid_response' }));
  });

  it.each([
    ['rooms.listRoomMessages', { items: [message], nextCursor: null, hasMore: false }],
    ['rooms.listRoomRuns', { items: [run], nextCursor: null, hasMore: false }],
  ])('rejects %s history from another room', (channel, page) => {
    expect(parse(channel as string, { roomId: 'r' }, page)).toEqual(page);
    expect(() => parse(channel as string, { roomId: 'other' }, page)).toThrow(expect.objectContaining({ code: 'invalid_response' }));
  });

  it('preserves a requested message page upper bound and rejects replayed items', () => {
    const input = { roomId: 'r', cursor: { roomId: 'r', afterKey: 5, throughKey: 10 } };
    const page = { items: [message], nextCursor: { roomId: 'r', afterKey: 6, throughKey: 10 }, hasMore: true };
    expect(parse('rooms.listRoomMessages', input, page)).toEqual(page);
    expect(() => parse('rooms.listRoomMessages', input, { ...page, nextCursor: { ...page.nextCursor, throughKey: 11 } })).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    expect(() => parse('rooms.listRoomMessages', input, { items: [{ ...message, sortKey: 5 }], nextCursor: null, hasMore: false })).toThrow(expect.objectContaining({ code: 'invalid_response' }));
  });
});
