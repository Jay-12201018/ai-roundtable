import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { createMemoryKeyBackend, KeyService } from '../../../src/main/security/KeyService';
import { bridge } from '../../unit/rendererSubscriptions/fixtures';
import { DEMO_GOAL } from '../../../src/renderer/features/onboarding';

const policy: ApprovedModelPolicy = {
  evidence: 'owned fixture', outputTokenParameter: 'max_tokens', contextWindowTokens: 100000, maxOutputTokens: 4096,
  counter: { modelId: 'deepseek-flash', method: 'fixture bytes; upper bound', kind: 'upper_bound', countMessages: ms => 32 + ms.reduce((n, m) => n + 16 + Buffer.byteLength(m.content), 0) },
  price: { currency: 'CNY', inputMicroCnyPerToken: 2, outputMicroCnyPerToken: 8, maxRequestMicroCny: 50000, reviewedAt: '2026-10-22T01:00:00.000Z', expiresAt: '2999-01-01T00:00:00.000Z', evidence: 'owned fixture price' },
};
const databases: Database[] = [];
afterEach(() => { cleanup(); localStorage.clear(); databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  const keys = new KeyService(db, createMemoryKeyBackend());
  const network = vi.fn(async () => { throw new Error('no network in this test'); });
  const registry = new ProviderRegistry(db, keys, { transportFactory: () => network, policyResolver: (configuration, modelId) => configuration.baseUrl?.startsWith('https://api.deepseek.com') && modelId === 'deepseek-flash' ? policy : undefined });
  const fake = bridge();
  window.roundtable = { ...fake.api, host: { command: vi.fn() }, summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn() }, usage: { getReport: vi.fn(async () => { throw new Error('none'); }), writeOff: vi.fn(), exportCsv: vi.fn() },
    rooms: new RoomService(db), settings: new ProviderSettingsService(db, keys, registry) } as unknown as typeof window.roundtable;
  return { db, network, ...fake };
}

it('D6-A 开始试玩 adds the demo service and a 演示房间 with three demo members, the goal in the box and nothing started', async () => {
  const f = fixture(); render(<App />);
  await screen.findByRole('heading', { name: '让几位 AI 围坐一桌，替你把问题讨论透' });
  expect(document.body.textContent).toContain('回复是预先写好的示例，不代表真实模型的水平');
  // It promises only what Main allows today: the unreviewed services can be connected, not used in a discussion.
  expect(document.body.textContent).toContain('目前可以用于讨论的是 DeepSeek；OpenAI、Anthropic Claude、Google Gemini 和其他兼容服务可以先连接，价格审核后开放讨论。');
  expect(document.body.textContent).not.toContain('支持 DeepSeek');
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
  fireEvent.click(within(wizard).getByRole('button', { name: '下一步' }));
  fireEvent.change(within(wizard).getByLabelText('API Key'), { target: { value: 'owned-fake-key' } });
  fireEvent.click(within(wizard).getByRole('button', { name: '保存并连接' }));
  await within(wizard).findByText(/已为你建好房间「我的第一场讨论」，3 位成员（起草者、审查者、综合者）都使用 DeepSeek Flash/u);
  const [room] = f.db.listRooms();
  expect(f.db.listAgentConfigurations(room.id).every(agent => agent.modelId === 'deepseek-flash')).toBe(true);
  fireEvent.click(within(wizard).getByRole('button', { name: '去开始讨论' }));
  await screen.findByRole('heading', { name: '这场讨论要解决什么？' });
  await waitFor(() => expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('我的第一场讨论'));
  expect(f.network).not.toHaveBeenCalled(); expect(f.api.run.start).not.toHaveBeenCalled();
});
