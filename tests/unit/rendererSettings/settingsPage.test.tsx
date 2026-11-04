import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage, type SettingsSection } from '../../../src/renderer/features/settings';
import type { ProviderConfiguration, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';

const at = '2026-10-16T00:00:00.000Z';
const config = (value: Partial<ProviderConfiguration> & Pick<ProviderConfiguration, 'id' | 'name' | 'kind'>): ProviderConfiguration => ({
  baseUrl: null, enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: null, createdAt: at, updatedAt: at, ...value });
const summary = (value: ProviderConfiguration): ProviderSummary => ({ id: value.id, name: value.name, kind: value.kind, enabled: value.enabled, isDefault: value.isDefault,
  defaultModelId: value.defaultModelId, customModels: value.customModels, configurationValid: true, hasStoredKey: false });
const deepseek = config({ id: 'ds', name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com/', isDefault: true, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
const glm = config({ id: 'oa', name: '智谱 GLM', kind: 'compatible', baseUrl: 'https://service.example/v1', defaultModelId: 'kimi-k3.1-pro' });
const kimi = config({ id: 'km', name: 'Kimi', kind: 'compatible', baseUrl: 'https://kimi.example/v1', defaultModelId: 'moonshot', customModels: [{ id: 'moonshot', name: 'moonshot' }] });
const mock = config({ id: 'mk', name: '演示（Mock）', kind: 'mock', defaultModelId: 'mock' });
const ready = (providerId: string, value: Partial<ProviderReadiness>): ProviderReadiness => ({ providerId, keyState: 'missing', baseUrl: null, models: [], ...value });

function fixture(readiness: ProviderReadiness[]) {
  const records = new Map([deepseek, glm, kimi, mock].map(value => [value.id, structuredClone(value)]));
  const api: ProviderSettingsApiContract = {
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
function show(api: ProviderSettingsApiContract, extra: { section?: SettingsSection } = {}) {
  const providers = [deepseek, glm, kimi, mock].map(summary);
  return render(<SettingsPage api={api} providers={providers} providerLoadState="ready" onProvidersChanged={() => {}} theme="system" setTheme={() => {}}
    section={extra.section ?? 'services'} onSection={() => {}} />);
}
const card = (name: string) => screen.getByRole('region', { name });
afterEach(cleanup);

describe('设置 › 模型服务', () => {
  it('states each service in words, as Main decides it (D114)', async () => {
    const { api } = fixture([
      ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('oa', { keyState: 'missing', models: [{ modelId: 'kimi-k3.1-pro', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] }),
      ready('km', { keyState: 'configured', baseUrl: 'https://kimi.example/v1', models: [{ modelId: 'moonshot', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('mk', { keyState: 'none', models: [{ modelId: 'mock', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
    ]);
    show(api);
    await waitFor(() => expect(within(card('DeepSeek')).getByText('可以使用')).toBeTruthy());
    expect(within(card('智谱 GLM')).getByText('还没填写 Key')).toBeTruthy();
    // D136: a Key is all a service needs, whichever address it goes to.
    expect(within(card('Kimi')).getByText('可以使用')).toBeTruthy();
    expect(within(card('演示（Mock）')).getByText('内置')).toBeTruthy();
    // The address is written down, the Key never shown, each model's limits stated.
    await within(card('DeepSeek')).findByText('https://api.deepseek.com');
    expect(card('DeepSeek').textContent).toContain('官方地址');
    expect(card('DeepSeek').textContent).not.toContain('确认');
    expect(card('DeepSeek').textContent).toContain('已保存（不显示）');
    expect(card('DeepSeek').textContent).toContain('上下文 128,000 · 最大输出 8,192');
  });

  it('测试连接 uses the free model list first and says what it found', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] })]);
    vi.mocked(api.testConnection).mockImplementation(async ({ providerId, level }) => ({ providerId, result: { requestId: 'r', level, ok: true } }));
    show(api);
    const deepseekCard = card('DeepSeek');
    const button = await within(deepseekCard).findByRole('button', { name: '测试连接' });
    expect(deepseekCard.textContent).toContain('可能产生极少的费用');
    fireEvent.click(button);
    await within(deepseekCard).findByText(/Key 有效，连接正常/u);
    expect(vi.mocked(api.testConnection).mock.calls.map(([input]) => input.level)).toEqual(['configuration', 'authentication']);
    // The two old checks are one button now.
    expect(within(deepseekCard).queryByRole('button', { name: '试发一条' })).toBeNull();
    expect(within(deepseekCard).queryByRole('button', { name: '检查连接' })).toBeNull();
  });

  it('测试连接 falls back to one very short message when the service has no model list', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] })]);
    show(api);
    const deepseekCard = card('DeepSeek');
    fireEvent.click(await within(deepseekCard).findByRole('button', { name: '测试连接' }));
    await within(deepseekCard).findByText(/已收到回复，连接正常/u);
    expect(api.testConnection).toHaveBeenLastCalledWith({ providerId: 'ds', level: 'generation', modelId: 'deepseek-flash', allowGeneration: true });
  });

  it('测试连接 does not send a message when the Key was refused, and says so', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] })]);
    vi.mocked(api.testConnection).mockImplementation(async ({ providerId, level }) => ({ providerId, result: level === 'configuration' ? { requestId: 'r', level, ok: true } : { requestId: 'r', level, ok: false, error: publicError('authentication_failed') } }));
    show(api);
    const deepseekCard = card('DeepSeek');
    fireEvent.click(await within(deepseekCard).findByRole('button', { name: '测试连接' }));
    await waitFor(() => expect(vi.mocked(api.testConnection).mock.calls.length).toBe(2));
    expect(vi.mocked(api.testConnection).mock.calls.map(([input]) => input.level)).toEqual(['configuration', 'authentication']);
    expect(within(deepseekCard).queryByText(/连接正常/u)).toBeNull();
  });

  it('refuses a pasted Key as a model name and keeps dangerous deletions behind a second, red confirmation', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [] })]);
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
    const { api } = fixture([ready('km', { keyState: 'configured', baseUrl: 'https://kimi.example/v1', models: [] })]);
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

describe('设置的分类', () => {
  it('offers services, appearance and privacy, and nothing else', async () => {
    const { api } = fixture([]);
    show(api);
    await screen.findByRole('button', { name: '添加服务' });
    expect(['模型服务', '外观', '数据与隐私'].every(name => screen.queryAllByRole('button', { name }).length > 0)).toBe(true);
    expect(screen.queryByRole('button', { name: '网络' })).toBeNull();
  });
});
