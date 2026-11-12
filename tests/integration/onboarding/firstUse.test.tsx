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
  const network = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> => { throw new Error("no network in this test"); });
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => network, });
  const fake = bridge();
  window.roundtable = { ...fake.api, host: { command: vi.fn() }, summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn(), revoke: vi.fn() }, usage: { getReport: vi.fn(async () => { throw new Error('none'); }), writeOff: vi.fn(), exportCsv: vi.fn() },
    rooms: new RoomService(db), settings: new ProviderSettingsService(db, keys, registry) } as unknown as typeof window.roundtable;
  return { db, network, ...fake };
}

it('D6-A 开始试玩 adds the demo service and a 演示项目 with three demo members, the goal in the box and nothing started', async () => {
  const f = fixture(); render(<App />);
  await screen.findByRole('heading', { name: '让几位 AI 围坐一桌，替你把问题讨论透' });
  expect(document.body.textContent).toContain('回复是预先写好的示例，不代表真实模型的水平');
  expect(document.body.textContent).toContain('支持国内主流大模型：DeepSeek、豆包、通义千问、Kimi、智谱 GLM、百度文心、腾讯混元、MiniMax。');
  fireEvent.click(screen.getByRole('button', { name: '开始试玩' }));
  await screen.findByRole('heading', { name: '想和大家聊点什么？' });
  const [provider] = f.db.listProviderSummaries();
  expect(provider).toMatchObject({ kind: 'mock', isDefault: false });
  const [room] = f.db.listRooms();
  expect(room.name).toBe('演示项目');
  expect(f.db.listAgentConfigurations(room.id).map(agent => [agent.displayName, agent.providerId, agent.modelId])).toEqual([
    ['林舟', provider.id, 'mock'], ['阿哲', provider.id, 'mock'], ['小雨', provider.id, 'mock']]);
  expect((screen.getByRole('textbox', { name: /第一条消息/u }) as HTMLTextAreaElement).value).toBe(DEMO_GOAL);
  expect(f.api.run.start).not.toHaveBeenCalled(); expect(f.network).not.toHaveBeenCalled();
  // D171: the page is the demo project's own new discussion. The app's opening move (a new 独立讨论 when nothing is open) stays
  // out of the way while the demo is being made, so there is one place to start and it is this one.
  await waitFor(() => expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('演示项目'));
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('演示项目');
  expect((f.db as unknown as { db: { prepare(sql: string): { pluck(): { get(): number } } } }).db.prepare("SELECT COUNT(*) FROM rooms WHERE kind='standalone'").pluck().get()).toBe(0);
});

it('D6-A, D167 connecting the first real service opens a new 独立讨论 with the lineup on its usable default model', async () => {
  const f = fixture(); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '连接…' }));
  const wizard = screen.getByRole('dialog');
  fireEvent.click(within(wizard).getByRole('button', { name: /^DeepSeek/u }));
  fireEvent.change(within(wizard).getByLabelText('API Key'), { target: { value: 'owned-fake-key' } });
  fireEvent.click(within(wizard).getByRole('button', { name: '保存' }));
  // Saving is the last step: the wizard closes on a new discussion, with no project to make first.
  await screen.findByRole('heading', { name: '想和大家聊点什么？' });
  expect(f.db.listRooms()).toEqual([]);
  const rooms = (f.db as unknown as { db: { prepare(sql: string): { pluck(): { all(): string[] } } } }).db.prepare("SELECT id FROM rooms WHERE kind='standalone'").pluck().all();
  expect(rooms).toHaveLength(1);
  expect(f.db.listAgentConfigurations(rooms[0]!).map(agent => [agent.displayName, agent.modelId])).toEqual([['林舟', 'deepseek-flash'], ['阿哲', 'deepseek-flash'], ['小雨', 'deepseek-flash']]);
  // The lineup itself is untouched: its members still have no model of their own.
  expect(f.db.listAgentConfigurations(f.db.getLineup().id).every(agent => agent.modelId === null)).toBe(true);
  await waitFor(() => expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('独立讨论'));
  // Nothing is generated: the only request is the service's model list (D143).
  await waitFor(() => expect(f.network).toHaveBeenCalledTimes(1));
  expect(f.network.mock.calls[0]).toMatchObject([expect.stringMatching(/\/models$/u), { method: 'GET' }]);
  expect(f.api.run.start).not.toHaveBeenCalled();
});
