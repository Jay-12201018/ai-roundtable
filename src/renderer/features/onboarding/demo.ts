import type { ProviderSettingsApiContract, ProviderSummary, RoomConfiguration, RoomManagementApiContract } from '../../../shared/contracts/configuration';
import { createStarterRoom } from '../rooms/templates';

/** A goal the demo members can discuss at once; it is only put in the box, never started for the host. */
export const DEMO_GOAL = '为学校设计一个校园跑腿平台的试点方案：范围、定价和第一个月的目标。';

/**
 * 开始试玩 (D6-A): the demo service (reused when it exists, never made the default) and a 演示项目 with the three
 * default members on it. Not atomic: a failure after the service exists leaves it in 设置, where it can be deleted.
 */
export async function startDemo(settings: ProviderSettingsApiContract, rooms: RoomManagementApiContract, providers: readonly ProviderSummary[]): Promise<RoomConfiguration> {
  const existing = providers.find(provider => provider.kind === 'mock' && provider.enabled);
  const demo = existing ?? await settings.createProvider({ name: '演示（Mock）', kind: 'mock', enabled: true, isDefault: false, defaultModelId: 'mock', customModels: [] });
  return createStarterRoom(rooms, { name: '演示项目', objective: DEMO_GOAL }, { providerId: demo.id, modelId: 'mock' });
}
