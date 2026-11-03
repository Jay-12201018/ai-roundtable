import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings';
import { ConnectWizard } from '../../../src/renderer/features/settings';
import type { ProviderSettingsApiContract } from '../../../src/shared/contracts/configuration';

const databases: Database[] = [];
afterEach(() => { cleanup(); databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  const keys = new KeyService(database, createMemoryKeyBackend());
  const network = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> => { throw new Error('Network disabled in the wizard test'); });
  const registry = new ProviderRegistry(database, keys, { transportFactory: () => network,
    });
  const api = new ProviderSettingsService(database, keys, registry);
  return { database, keys, registry, api, network };
}
const open = (api: ProviderSettingsApiContract, extra: Partial<Parameters<typeof ConnectWizard>[0]> = {}) => {
  const onClose = vi.fn(); const onConnected = vi.fn(async () => ({ roomName: '我的第一场讨论', memberNames: ['起草者', '审查者', '综合者'], modelName: 'DeepSeek Flash' }));
  render(<ConnectWizard api={api} providers={[]} onClose={onClose} onConnected={onConnected} {...extra} />);
  return { onClose, onConnected };
};
const keyInput = () => screen.getByLabelText('API Key') as HTMLInputElement;

it('D113 connects DeepSeek in three steps: the address above the Key, 保存并连接 confirms it, the Key never stays in the page', async () => {
  const { database, registry, api, network } = fixture();
  const { onConnected } = open(api);
  expect(screen.getByRole('button', { name: /^DeepSeek/u }).getAttribute('aria-pressed')).toBe('true');
  for (const name of ['OpenAI', 'Anthropic Claude', 'Google Gemini']) expect(screen.getByRole('button', { name: new RegExp(`^${name}`, 'u') }).textContent).not.toMatch(/价格|审核/u);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByRole('heading', { name: '填写 DeepSeek 的 API Key' })).toBeTruthy();
  expect(screen.getByRole('note').textContent).toBe('Key 只会发往 https://api.deepseek.com');
  expect(screen.getByText('保存即表示你确认了上面的地址')).toBeTruthy();
  const save = screen.getByRole('button', { name: '保存并连接' });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-wizard-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
  // The DOM value is gone before Main answers.
  expect(keyInput().value).toBe('');
  await screen.findByRole('heading', { name: 'DeepSeek 已连接' });
  const provider = database.listProviderSummaries()[0];
  expect(provider).toMatchObject({ name: 'DeepSeek', kind: 'openai-compatible', isDefault: true, defaultModelId: 'deepseek-flash' });
  expect(database.getProviderConfiguration(provider.id)?.baseUrl).toBe('https://api.deepseek.com/');
  expect(registry.isTargetConfirmed(provider.id)).toBe(true);
  // The check does not pretend: the model list cannot be read in this test environment, and it says so.
  expect(screen.getByText('Key 没能核对')).toBeTruthy();
  expect(screen.getByText('DeepSeek Flash 可以用于讨论')).toBeTruthy();
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ firstReal: true, provider: expect.objectContaining({ id: provider.id }) }));
  await screen.findByText(/已为你建好房间「我的第一场讨论」/u);
  expect(document.body.textContent).not.toContain('owned-fake-wizard-key');
  // Only the model list was asked for; nothing was generated.
  expect(network.mock.calls.every(call => String(call[0]).endsWith('/models'))).toBe(true);
});

it('D134: a second official service works for discussions right after the Key is saved', async () => {
  const { database, api } = fixture();
  const { onConnected } = open(api, { providers: [{ id: 'x', name: 'DeepSeek', kind: 'openai-compatible', enabled: true, isDefault: true, defaultModelId: 'deepseek-flash', customModels: [], configurationValid: true, hasStoredKey: true }] });
  fireEvent.click(screen.getByRole('button', { name: /^OpenAI/u }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByRole('note').textContent).toBe('Key 只会发往 https://api.openai.com/v1');
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-openai-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
  await screen.findByRole('heading', { name: 'OpenAI 已连接' });
  expect(screen.getByText('GPT-6 Astra 可以用于讨论')).toBeTruthy();
  // A second real service is not the first: no starter room, and it does not take the default.
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ firstReal: false }));
  expect(database.listProviderSummaries().find(item => item.kind === 'openai')?.isDefault).toBe(false);
  expect(screen.getByRole('button', { name: '试发一条' })).toBeTruthy();
});

it('a user-typed address is shown as the Key target and must be a safe https (or local http) address', async () => {
  const { database, registry, api } = fixture();
  open(api);
  fireEvent.click(screen.getByRole('button', { name: /^其他兼容服务/u }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: 'Kimi' } });
  for (const bad of ['http://kimi.example/v1', 'https://user:secret@kimi.example/v1', 'https://kimi.example/v1?x=1']) {
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: bad } });
    expect(screen.getByRole('note').textContent).toBe('先填写上面的地址，这里会写明 Key 会发往哪里。');
    expect(document.body.textContent).toContain('地址必须以 https:// 开头');
  }
  fireEvent.change(screen.getByLabelText('地址'), { target: { value: 'https://kimi.example/v1' } });
  expect(screen.getByRole('note').textContent).toBe('Key 只会发往 https://kimi.example/v1');
  // D096: a Key pasted into the model field is refused before anything is saved.
  fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' } });
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-kimi-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
  expect((await screen.findAllByRole('alert')).some(item => item.textContent?.includes('这看起来是 API Key'))).toBe(true);
  expect(database.listProviderSummaries()).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'moonshot-v1-8k' } });
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-kimi-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
  await screen.findByRole('heading', { name: 'Kimi 已连接' });
  const provider = database.listProviderSummaries()[0];
  expect(database.getProviderConfiguration(provider.id)).toMatchObject({ name: 'Kimi', baseUrl: 'https://kimi.example/v1', defaultModelId: 'moonshot-v1-8k' });
  expect(registry.confirmedTarget(provider.id)).toBe('https://kimi.example/v1');
});

it('adds the demo service without a Key, address or network, and never as the default service', async () => {
  const { database, api, network } = fixture();
  const { onConnected } = open(api);
  fireEvent.click(screen.getByRole('button', { name: /^演示（Mock）/u }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.queryByLabelText('API Key')).toBeNull();
  expect(screen.getByText(/不代表真实模型的水平/u)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '添加演示服务' }));
  await screen.findByText('演示服务已添加');
  expect(database.listProviderSummaries()[0]).toMatchObject({ kind: 'mock', isDefault: false, defaultModelId: 'mock' });
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ firstReal: false }));
  expect(network).not.toHaveBeenCalled();
});

it('replacing a Key goes straight to the address and Key; closing without saving changes nothing', async () => {
  const { database, keys, registry, api } = fixture();
  const provider = await api.createProvider({ name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  await keys.storeKey(provider.id, 'owned-old-key'); registry.confirmTarget({ providerId: provider.id, baseUrl: 'https://api.deepseek.com', confirmed: true });
  const { onClose } = open(api, { rekey: database.getProviderConfiguration(provider.id)! });
  expect(screen.getByRole('heading', { name: '更换 DeepSeek 的 API Key' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '上一步' })).toBeNull();
  fireEvent.change(keyInput(), { target: { value: 'owned-new-key' } });
  // Closing without saving clears the field and changes nothing.
  fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' })[0]);
  expect(onClose).toHaveBeenCalled();
  expect(registry.isTargetConfirmed(provider.id)).toBe(true);
});

it('never shows a backend error text that could carry the Key; the message is fixed', async () => {
  const { api } = fixture();
  vi.spyOn(api, 'setKey').mockRejectedValue(Object.assign(new Error('echo owned-fake-leak-key'), { code: 'authentication_failed', detail: 'owned-fake-leak-key' }));
  open(api);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-leak-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。'));
  expect(document.body.textContent).not.toContain('owned-fake-leak-key');
});
