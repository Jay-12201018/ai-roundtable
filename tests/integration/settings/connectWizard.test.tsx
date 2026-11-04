import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { ProviderSettingsService } from '../../../src/main/settings';
import { ConnectWizard } from '../../../src/renderer/features/settings';
import { presets } from '../../../src/renderer/features/settings/presets';
import type { ProviderSettingsApiContract } from '../../../src/shared/contracts/configuration';

const databases: Database[] = [];
afterEach(() => { cleanup(); databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  const keys = new KeyService(database, createMemoryKeyBackend());
  const network = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> => { throw new Error('Network disabled in the wizard test'); });
  const registry = new ProviderRegistry(database, keys, { transportFactory: () => network });
  const api = new ProviderSettingsService(database, keys, registry);
  return { database, keys, registry, api, network };
}
const open = (api: ProviderSettingsApiContract, extra: Partial<Parameters<typeof ConnectWizard>[0]> = {}) => {
  const onClose = vi.fn(); const onStart = vi.fn(); const onConnected = vi.fn(async () => ({ roomId: 'starter-room', roomName: '我的第一场讨论', memberNames: ['起草者', '审查者', '综合者'], modelName: 'DeepSeek Flash' }));
  render(<ConnectWizard api={api} providers={[]} onClose={onClose} onStart={onStart} onConnected={onConnected} {...extra} />);
  return { onClose, onStart, onConnected };
};
const keyInput = () => screen.getByLabelText('API Key') as HTMLInputElement;
const usable = (registry: ProviderRegistry, providerId: string, modelId: string) => {
  registry.checkGeneration(providerId, { requestId: '00000000-0000-4000-8000-000000000000', modelId, messages: [{ role: 'user', content: 'x' }], outputTokenLimit: 8 });
  return true;
};
const pick = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

it('D143 offers the eight catalog services in order, DeepSeek first and recommended, then the demo', () => {
  const { api } = fixture();
  open(api);
  const offered = within(screen.getByRole('group', { name: '服务' })).getAllByRole('button').map(button => button.textContent ?? '');
  for (const [index, name] of ['DeepSeek', '豆包', '通义千问', 'Kimi', '智谱 GLM', '百度文心', '腾讯混元', 'MiniMax', '演示（Mock）'].entries()) expect(offered[index]).toContain(name);
  expect(offered).toHaveLength(9);
  expect(offered[0]).toContain('推荐');
  expect(offered.slice(1).join('')).not.toContain('推荐');
  // Every built-in address is the service's own https endpoint, and each has at least one model to pick.
  for (const preset of presets.filter(item => item.baseUrl)) {
    expect(preset.baseUrl!.startsWith('https://')).toBe(true);
    expect(preset.models.length).toBeGreaterThan(0);
  }
});

it('D136 connects a service with a pasted Key: pick it, paste, save, and the discussion is one click away', async () => {
  const { database, registry, api, network } = fixture();
  const { onConnected, onClose, onStart } = open(api);
  pick(/^DeepSeek/u);
  expect(screen.getByRole('heading', { name: '连接 DeepSeek' })).toBeTruthy();
  expect(screen.getByRole('note').textContent).toBe('Key 只会发往 https://api.deepseek.com');
  // No step, checkbox or button asks to confirm the address; the save waits only for the Key.
  expect(screen.queryByRole('button', { name: '下一步' })).toBeNull();
  expect(document.body.textContent).not.toContain('确认');
  const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-wizard-key' } });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  // The DOM value is gone before Main answers.
  expect(keyInput().value).toBe('');
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const provider = database.listProviderSummaries()[0];
  expect(provider).toMatchObject({ name: 'DeepSeek', kind: 'compatible', isDefault: true, defaultModelId: 'deepseek-flash' });
  expect((await api.getProviderKeyState({ providerId: provider.id })).state).toBe('session');
  expect(database.getProviderConfiguration(provider.id)?.baseUrl).toBe('https://api.deepseek.com/');
  expect(usable(registry, provider.id, 'deepseek-flash')).toBe(true);
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ firstReal: true, provider: expect.objectContaining({ id: provider.id }) }));
  // The room just made, not whichever room was open before (an earlier demo room, say).
  expect(onStart).toHaveBeenCalledWith('starter-room');
  expect(document.body.textContent).not.toContain('owned-fake-wizard-key');
  // Saving sends nothing: the network is used only when the host asks for 测试连接.
  expect(network).not.toHaveBeenCalled();
});

it('D134 a second service works right after its Key is saved, and does not take the default', async () => {
  const { database, api } = fixture();
  const { onConnected, onStart, onClose } = open(api, { providers: [{ id: 'x', name: 'DeepSeek', kind: 'compatible', enabled: true, isDefault: true, defaultModelId: 'deepseek-flash', customModels: [], configurationValid: true, hasStoredKey: true }] });
  pick(/^Kimi/u);
  expect(screen.getByRole('note').textContent).toBe('Key 只会发往 https://api.moonshot.cn/v1');
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-kimi-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ firstReal: false }));
  expect(onStart).not.toHaveBeenCalled();
  expect(database.listProviderSummaries().find(item => item.name === 'Kimi')).toMatchObject({ isDefault: false, defaultModelId: 'kimi-k3.1-pro' });
});

it('D143 the only things to fill in are the Key and a model from the list; nothing takes an address or a typed model name', async () => {
  const { database, registry, api } = fixture();
  const { onClose } = open(api);
  pick(/^Kimi/u);
  // Text boxes have the role textbox; the Key is a password field, which does not.
  expect(screen.queryAllByRole('textbox')).toEqual([]);
  const model = screen.getByLabelText('模型') as HTMLSelectElement;
  expect(model.tagName).toBe('SELECT');
  expect(model.value).toBe('kimi-k3.1-pro');
  expect([...model.options].map(option => option.value)).toEqual(['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3']);
  fireEvent.change(model, { target: { value: 'kimi-k3' } });
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-picked-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const provider = database.listProviderSummaries()[0];
  expect(provider).toMatchObject({ kind: 'compatible', defaultModelId: 'kimi-k3' });
  expect(database.getProviderConfiguration(provider.id)!.customModels.map(item => item.id)).toEqual(['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3']);
  expect(usable(registry, provider.id, 'kimi-k3')).toBe(true);
});

it.each([[/^通义千问/u, '华北 2（北京）'], [/^豆包/u, '华北 2（北京）']])('D143 %s says which region the Key has to come from', (name, region) => {
  const { api } = fixture();
  open(api);
  pick(name);
  expect(document.body.textContent).toContain(region);
});

it('测试连接 saves what is filled in and says what it found; it stays beside its cost note and nothing waits for it', async () => {
  const { database, api } = fixture();
  const test = vi.spyOn(api, 'testConnection').mockResolvedValue({ providerId: 'p', result: { requestId: 'r', level: 'generation', ok: true } });
  const { onClose } = open(api);
  pick(/^DeepSeek/u);
  expect(screen.getByText('会发一条很短的消息，可能产生极少的费用')).toBeTruthy();
  const button = screen.getByRole('button', { name: '测试连接' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-test-key' } });
  fireEvent.click(button);
  await screen.findByText('已收到回复，连接正常');
  expect(test).toHaveBeenCalledWith({ providerId: database.listProviderSummaries()[0].id, level: 'generation', modelId: 'deepseek-flash', allowGeneration: true });
  expect(onClose).not.toHaveBeenCalled();
  expect(keyInput().value).toBe('');
  // The service exists now: 上一步 could only send that saved Key elsewhere, so it is gone.
  expect(screen.queryByRole('button', { name: '上一步' })).toBeNull();
  // The Key is saved, so 保存 finishes without it, and does not create a second service.
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(database.listProviderSummaries()).toHaveLength(1);
});

it('adds the demo service without a Key, address or network, and never as the default service', async () => {
  const { database, api, network } = fixture();
  const { onConnected, onClose } = open(api);
  pick(/^演示（Mock）/u);
  expect(screen.queryByLabelText('API Key')).toBeNull();
  expect(screen.queryByRole('button', { name: '测试连接' })).toBeNull();
  expect(screen.getByText(/不代表真实模型的水平/u)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '添加演示服务' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(database.listProviderSummaries()[0]).toMatchObject({ kind: 'mock', isDefault: false, defaultModelId: 'mock' });
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ firstReal: false }));
  expect(network).not.toHaveBeenCalled();
});

it('replacing a Key goes straight to the Key; closing without saving changes nothing', async () => {
  const { database, keys, api } = fixture();
  const provider = await api.createProvider({ name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
  const reference = await keys.storeKey(provider.id, 'owned-old-key');
  const { onClose } = open(api, { rekey: database.getProviderConfiguration(provider.id)! });
  expect(screen.getByRole('heading', { name: '更换 DeepSeek 的 API Key' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '上一步' })).toBeNull();
  fireEvent.change(keyInput(), { target: { value: 'owned-new-key' } });
  fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' })[0]);
  expect(onClose).toHaveBeenCalled();
  expect(keyInput().value).toBe('');
  expect(await keys.resolveKey(provider.id, reference)).toBe('owned-old-key');
});

it('never shows a backend error text that could carry the Key; the message is fixed', async () => {
  const { api } = fixture();
  vi.spyOn(api, 'setKey').mockRejectedValue(Object.assign(new Error('echo owned-fake-leak-key'), { code: 'authentication_failed', detail: 'owned-fake-leak-key' }));
  open(api);
  pick(/^DeepSeek/u);
  fireEvent.change(keyInput(), { target: { value: 'owned-fake-leak-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。'));
  expect(document.body.textContent).not.toContain('owned-fake-leak-key');
});
