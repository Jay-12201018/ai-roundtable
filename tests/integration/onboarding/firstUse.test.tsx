import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { createMemoryKeyBackend, KeyService } from '../../../src/main/security/KeyService';
import { bridge } from '../../unit/rendererSubscriptions/fixtures';
import { DEMO_GOAL } from '../../../src/renderer/features/onboarding';

const databases: Database[] = [];
afterEach(() => { cleanup(); localStorage.clear(); databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  const keys = new KeyService(db, createMemoryKeyBackend());
  const network = vi.fn(async () => { throw new Error('no network in this test'); });
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => network, });
  const fake = bridge();
  window.roundtable = { ...fake.api, host: { command: vi.fn() }, summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn(), revoke: vi.fn() }, usage: { getReport: vi.fn(async () => { throw new Error('none'); }), writeOff: vi.fn(), exportCsv: vi.fn() },
    rooms: new RoomService(db), settings: new ProviderSettingsService(db, keys, registry) } as unknown as typeof window.roundtable;
  return { db, network, ...fake };
}

it('D6-A 开始试玩 adds the demo service and a 演示房间 with three demo members, the goal in the box and nothing started', async () => {
  const f = fixture(); render(<App />);
  await screen.findByRole('heading', { name: '让几位 AI 围坐一桌，替你把问题讨论透' });
  expect(document.body.textContent).toContain('回复是预先写好的示例，不代表真实模型的水平');
  expect(document.body.textContent).toContain('支持 DeepSeek、Kimi、通义千问、智谱 GLM、豆包、MiniMax，也可以添加其他通用接口的服务。');
  fireEvent.click(screen.getByRole('button', { name: '开始试玩' }));
  await screen.findByRole('heading', { name: '这场讨论要解决什么？' });
  const [provider] = f.db.listProviderSummaries();
  expect(provider).toMatchObject({ kind: 'mock', isDefault: false });
  const [room] = f.db.listRooms();
  expect(room.name).toBe('演示房间');
  expect(f.db.listAgentConfigurations(room.id).map(agent => [agent.displayName, agent.providerId, agent.modelId])).toEqual([
    ['起草者', provider.id, 'mock'], ['审查者', provider.id, 'mock'], ['综合者', provider.id, 'mock']]);
  expect((screen.getByRole('textbox', { name: /讨论目标/u }) as HTMLTextAreaElement).value).toBe(DEMO_GOAL);
  expect(f.api.run.start).not.toHaveBeenCalled(); expect(f.network).not.toHaveBeenCalled();
});

it('D6-A connecting the first real service creates 我的第一场讨论 on its usable default model', async () => {
  const f = fixture(); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '连接…' }));
  const wizard = screen.getByRole('dialog');
  fireEvent.click(within(wizard).getByRole('button', { name: /^DeepSeek/u }));
  fireEvent.change(within(wizard).getByLabelText('API Key'), { target: { value: 'owned-fake-key' } });
  fireEvent.click(within(wizard).getByRole('button', { name: '保存' }));
  // Saving is the last step: the wizard closes on the new room's first discussion.
  await screen.findByRole('heading', { name: '这场讨论要解决什么？' });
  const [room] = f.db.listRooms();
  expect(f.db.listAgentConfigurations(room.id).every(agent => agent.modelId === 'deepseek-flash')).toBe(true);
  await waitFor(() => expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('我的第一场讨论'));
  expect(f.network).not.toHaveBeenCalled(); expect(f.api.run.start).not.toHaveBeenCalled();
});
