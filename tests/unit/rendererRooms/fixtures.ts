import { vi } from 'vitest';
import type { AgentConfiguration, RoomConfiguration, RoomsFeatureProps, ProviderSummary, RoomManagementApiContract } from '../../../src/shared/contracts/configuration';
export const timestamp = '2026-10-16T00:00:00.000Z';
export function room(id = 'r1', name = '项目讨论'): RoomConfiguration {
  return { id, name, objective: '检验证据', kind: 'project', brief: '', defaultMode: 'group-chat', archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
}
export function agent(id = 'a1', displayName = '构思员'): AgentConfiguration {
  return { id, roomId: 'r1', displayName, roleTemplateId: 'Drafter', systemPrompt: '先列证据', enabled: true, displayOrder: 0, providerId: 'p', modelId: 'mock', archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
}
export const providers: ProviderSummary[] = [{ id: 'p', name: '本地验证', kind: 'mock', enabled: true, isDefault: false, defaultModelId: 'mock', customModels: [{ id: 'mock', name: 'Mock' }], configurationValid: true, hasStoredKey: false }];
export function props(): RoomsFeatureProps {
  const api = {
    createRoom: vi.fn(async value => ({ ...room('new', value.name), objective: value.objective ?? '' })),
    updateRoom: vi.fn(async value => ({ ...room(), ...value })), getRoomConfiguration: vi.fn(async ({ id }) => room(id)),
    listRooms: vi.fn(async () => [room(), room('r2', '另一个房间')]),
    archiveRoom: vi.fn(async ({ id, archived = true }) => ({ ...room(id), archivedAt: archived ? timestamp : null })), deleteRoom: vi.fn(async () => {}),
    createAgent: vi.fn(async value => ({ ...agent('new-agent'), ...value })), updateAgent: vi.fn(async value => ({ ...agent(), ...value })),
    getAgentConfiguration: vi.fn(async ({ id }) => agent(id)), listAgentConfigurations: vi.fn(async () => [agent()]),
    reorderAgents: vi.fn(async ({ agentIds }) => agentIds.map((id: string, i: number) => ({ ...agent(id), displayOrder: i }))),
    archiveAgent: vi.fn(async ({ id, archived = true }) => ({ ...agent(id), archivedAt: archived ? timestamp : null })), deleteAgent: vi.fn(async () => {}),
    listRoomRuns: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    listRoomMessages: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    getLineup: vi.fn(async () => ({ ...room('roundtable-lineup', '常用阵容'), objective: '', kind: 'lineup' as const })),
    createStandalone: vi.fn(async () => ({ ...room('standalone-1', '独立讨论'), objective: '', kind: 'standalone' as const })),
    listStandalone: vi.fn(async () => []),
  } satisfies RoomManagementApiContract;
  return { api, providers, providerLoadState: 'ready', onReloadProviders: vi.fn(), onSelectRoom: vi.fn(), onSelectRun: vi.fn(), onOpenSettings: vi.fn() };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
