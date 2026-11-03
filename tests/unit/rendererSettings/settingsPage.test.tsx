import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage, type SettingsSection } from '../../../src/renderer/features/settings';
import type { NetworkApiContract } from '../../../src/shared/contracts/app';
import type { ProviderConfiguration, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';
import type { NetworkSettings } from '../../../src/shared/schemas/network';

const at = '2026-10-16T00:00:00.000Z';
const config = (value: Partial<ProviderConfiguration> & Pick<ProviderConfiguration, 'id' | 'name' | 'kind'>): ProviderConfiguration => ({
  baseUrl: null, enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: null, createdAt: at, updatedAt: at, ...value });
const summary = (value: ProviderConfiguration): ProviderSummary => ({ id: value.id, name: value.name, kind: value.kind, enabled: value.enabled, isDefault: value.isDefault,
  defaultModelId: value.defaultModelId, customModels: value.customModels, configurationValid: true, hasStoredKey: false });
const deepseek = config({ id: 'ds', name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/', isDefault: true, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
const openai = config({ id: 'oa', name: 'OpenAI', kind: 'openai', defaultModelId: 'gpt-4o-mini' });
const kimi = config({ id: 'km', name: 'Kimi', kind: 'openai-compatible', baseUrl: 'https://kimi.example/v1', defaultModelId: 'moonshot', customModels: [{ id: 'moonshot', name: 'moonshot' }] });
const mock = config({ id: 'mk', name: '演示（Mock）', kind: 'mock', defaultModelId: 'mock' });
const ready = (providerId: string, value: Partial<ProviderReadiness>): ProviderReadiness => ({ providerId, keyState: 'missing', targetConfirmed: false, confirmedBaseUrl: null, models: [], ...value });

function fixture(readiness: ProviderReadiness[]) {
  const records = new Map([deepseek, openai, kimi, mock].map(value => [value.id, structuredClone(value)]));
  const api: ProviderSettingsApiContract = {
    confirmTarget: vi.fn(async ({ providerId }) => ({ providerId })),
    listProviderSummaries: vi.fn(async () => [...records.values()].map(summary)),
    getProviderConfiguration: vi.fn(async ({ id }) => structuredClone(records.get(id)!)),
    getProviderKeyState: vi.fn(), getKeyStorageStatus: vi.fn(async () => ({ mode: 'secure', backend: 'f', persistent: true, message: '密钥将使用系统安全存储持久化。' } as const)),
    createProvider: vi.fn(), updateProvider: vi.fn(async input => { const value = { ...records.get(input.id!)!, ...input } as ProviderConfiguration; records.set(value.id, value); return value; }),
    deleteProvider: vi.fn(async () => {}), setKey: vi.fn(), deleteKey: vi.fn(async () => {}),
    listModels: vi.fn(async ({ providerId }) => ({ providerId, models: [{ id: 'listed-model', name: '列表模型' }] })),
    testConnection: vi.fn<ProviderSettingsApiContract['testConnection']>(async ({ providerId, level }) => ({ providerId, result: level === 'configuration' ? { requestId: 'r', level, ok: true }
      : level === 'authentication' ? { requestId: 'r', level, ok: false, error: publicError('unsupported') } : { requestId: 'r', level, ok: true } })),
    listModelReadiness: vi.fn(async () => readiness),
  };
  return { api, records };
}
function show(api: ProviderSettingsApiContract, extra: { section?: SettingsSection; network?: NetworkApiContract; relaunch?: () => Promise<void> } = {}) {
  const providers = [deepseek, openai, kimi, mock].map(summary);
  return render(<SettingsPage api={api} providers={providers} providerLoadState="ready" onProvidersChanged={() => {}} theme="system" setTheme={() => {}}
    section={extra.section ?? 'services'} onSection={() => {}} network={extra.network} lifecycle={extra.relaunch ? { relaunch: extra.relaunch } : undefined} />);
}
const card = (name: string) => screen.getByRole('region', { name });
afterEach(cleanup);

describe('设置 › 模型服务', () => {
  it('states each service in words, as Main decides it (D114)', async () => {
    const { api } = fixture([
      ready('ds', { keyState: 'configured', targetConfirmed: true, confirmedBaseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('oa', { keyState: 'missing', models: [{ modelId: 'gpt-4o-mini', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] }),
      ready('km', { keyState: 'configured', targetConfirmed: false, models: [{ modelId: 'moonshot', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] }),
      ready('mk', { keyState: 'none', models: [{ modelId: 'mock', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
    ]);
    show(api);
    await waitFor(() => expect(within(card('DeepSeek')).getByText('可以使用')).toBeTruthy());
    expect(within(card('OpenAI')).getByText('还没填写 Key')).toBeTruthy();
    expect(within(card('Kimi')).getByText('需要确认地址')).toBeTruthy();
    expect(within(card('演示（Mock）')).getByText('内置')).toBeTruthy();
    // DeepSeek is open: address confirmed when the Key was saved, the Key never shown, each model's limits stated.
    await within(card('DeepSeek')).findByText('https://api.deepseek.com');
    expect(card('DeepSeek').textContent).toContain('官方地址，保存 Key 时已确认');
    expect(card('DeepSeek').textContent).toContain('已保存（不显示）');
    expect(card('DeepSeek').textContent).toContain('上下文 128,000 · 最大输出 8,192');
  });

  it('confirms a remembered address in one click for the exact target written beside it', async () => {
    const { api } = fixture([ready('km', { keyState: 'configured', targetConfirmed: false, models: [] })]);
    show(api);
    fireEvent.click(await screen.findByRole('button', { name: '展开 Kimi' }));
    const note = await within(card('Kimi')).findByRole('note');
    expect(note.textContent).toContain('这把 Key 只会发往 https://kimi.example/v1');
    fireEvent.click(within(note).getByRole('button', { name: '确认地址' }));
    await waitFor(() => expect(api.confirmTarget).toHaveBeenCalledWith({ providerId: 'km', baseUrl: 'https://kimi.example/v1', confirmed: true }));
  });

  it('checks the connection and says honestly when the service has no way to check the Key', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', targetConfirmed: true, models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] })]);
    show(api);
    const deepseekCard = card('DeepSeek');
    fireEvent.click(await within(deepseekCard).findByRole('button', { name: '检查连接' }));
    await within(deepseekCard).findByText(/这个服务没有模型列表接口/u);
    expect(vi.mocked(api.testConnection).mock.calls.map(([input]) => input.level)).toEqual(['configuration', 'authentication']);
    // A generation only happens on its own button, with explicit consent.
    fireEvent.click(within(deepseekCard).getByRole('button', { name: '试发一条' }));
    await within(deepseekCard).findByText(/已收到回复/u);
    expect(api.testConnection).toHaveBeenLastCalledWith({ providerId: 'ds', level: 'generation', modelId: 'deepseek-flash', allowGeneration: true });
  });

  it('refuses a pasted Key as a model name and keeps dangerous deletions behind a second, red confirmation', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', targetConfirmed: true, models: [] })]);
    show(api);
    const deepseekCard = card('DeepSeek');
    fireEvent.click(await within(deepseekCard).findByRole('button', { name: '手动添加模型' }));
    fireEvent.change(within(deepseekCard).getByLabelText('模型名'), { target: { value: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' } });
    expect(within(deepseekCard).getByRole('alert').textContent).toContain('这看起来是 API Key');
    fireEvent.click(within(deepseekCard).getByRole('button', { name: '添加' }));
    expect(api.updateProvider).not.toHaveBeenCalled();
    fireEvent.click(within(deepseekCard).getByText('高级与删除'));
    fireEvent.click(within(deepseekCard).getByRole('button', { name: '删除 Key…' }));
    expect(api.deleteKey).not.toHaveBeenCalled();
    const confirm = within(deepseekCard).getByRole('button', { name: '确认删除 Key' });
    expect(confirm.className).toContain('is-danger');
    fireEvent.click(confirm);
    await waitFor(() => expect(api.deleteKey).toHaveBeenCalledWith({ providerId: 'ds' }));
  });

  it('warns that changing a typed address deletes the saved Key before it is saved', async () => {
    const { api } = fixture([ready('km', { keyState: 'configured', targetConfirmed: true, models: [] })]);
    show(api);
    fireEvent.click(await screen.findByRole('button', { name: '展开 Kimi' }));
    const kimiCard = card('Kimi');
    fireEvent.click(await within(kimiCard).findByText('高级与删除'));
    fireEvent.change(within(kimiCard).getByLabelText('请求地址'), { target: { value: 'https://other.example/v1' } });
    fireEvent.click(within(kimiCard).getByRole('button', { name: '保存（会删除已保存的 Key）' }));
    await waitFor(() => expect(api.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'km', baseUrl: 'https://other.example/v1' })));
    await within(kimiCard).findByText('地址已更改；原来的 Key 已删除，请重新填写。');
  });
});

describe('设置 › 网络与代理 (D115)', () => {
  const base: NetworkSettings = { saved: null, effective: { source: 'none', proxy: null }, restartRequired: false, savedInvalid: false };
  const network = (value: NetworkSettings) => ({
    getSettings: vi.fn(async () => value),
    saveSettings: vi.fn(async (input: NetworkSettings['saved']) => ({ ...value, saved: input, restartRequired: true })),
    testProxy: vi.fn(async () => ({ ok: false, target: 'api.deepseek.com', failure: 'refused' } as const)),
  });
  it('needs the explicit name-resolution choice, checks the proxy without a Key, and restarts on request', async () => {
    const { api } = fixture([]); const net = network(base); const relaunch = vi.fn(async () => {});
    show(api, { section: 'network', network: net as unknown as NetworkApiContract, relaunch });
    fireEvent.click(await screen.findByRole('switch', { name: '通过本机代理连接' }));
    // Nothing saved waits for a restart: the note is neutral.
    expect(document.querySelector('.net-effect')!.classList.contains('is-pending')).toBe(false);
    expect(document.querySelector('.net-effect')!.textContent).toContain('改动保存后，重启应用才会生效。');
    expect(screen.getByRole('alert').textContent).toBe('要使用代理，需要勾选“由代理解析域名”。');
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '检测代理' }));
    await screen.findByText(/这个端口上没有代理在运行/u);
    expect(net.testProxy).toHaveBeenCalledWith({ host: '127.0.0.1', port: 7890 });
    fireEvent.click(screen.getByLabelText(/由代理解析域名/u));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await screen.findByText('已保存，重启应用后生效。');
    expect(document.querySelector('.net-effect')!.classList.contains('is-pending')).toBe(true);
    expect(document.querySelector('.net-effect')!.textContent).toContain('保存的改动在重启应用后生效');
    expect(net.saveSettings).toHaveBeenCalledWith({ enabled: true, host: '127.0.0.1', port: 7890, trustProxyDns: true });
    fireEvent.click(screen.getByRole('button', { name: '立即重启' }));
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
  });
  it('says the environment wins and offers no restart for a saved choice it would ignore', async () => {
    const { api } = fixture([]);
    show(api, { section: 'network', network: network({ ...base, effective: { source: 'environment', proxy: { host: '127.0.0.1', port: 7890 } } }) as unknown as NetworkApiContract, relaunch: vi.fn() });
    await screen.findByText(/来自环境变量 ROUNDTABLE_CONNECT_PROXY/u);
    expect(document.body.textContent).toContain('环境变量优先');
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull();
  });
});
