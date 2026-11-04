import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage, type SettingsSection } from '../../../src/renderer/features/settings';
import type { ProviderConfiguration, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../src/shared/contracts/configuration';
import { discoveryText } from '../../../src/renderer/features/settings/model';
import { publicError } from '../../../src/shared/schemas/error';

const at = '2026-10-16T00:00:00.000Z';
const config = (value: Partial<ProviderConfiguration> & Pick<ProviderConfiguration, 'id' | 'name' | 'kind'>): ProviderConfiguration => ({
  baseUrl: null, enabled: true, isDefault: false, defaultModelId: null, customModels: [], keyReference: null, createdAt: at, updatedAt: at, ...value });
const summary = (value: ProviderConfiguration): ProviderSummary => ({ id: value.id, name: value.name, kind: value.kind, enabled: value.enabled, isDefault: value.isDefault,
  defaultModelId: value.defaultModelId, customModels: value.customModels, configurationValid: true, hasStoredKey: false });
const deepseek = config({ id: 'ds', name: 'DeepSeek', kind: 'compatible', baseUrl: 'https://api.deepseek.com/', isDefault: true, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] });
const glm = config({ id: 'oa', name: '智谱 GLM', kind: 'compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModelId: 'glm-5.3' });
const old = config({ id: 'old', name: '旧服务', kind: 'compatible', baseUrl: 'https://models.example/v1', enabled: false, defaultModelId: 'old-model', customModels: [{ id: 'old-model', name: 'old-model' }] });
const kimi = config({ id: 'km', name: 'Kimi', kind: 'compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModelId: 'kimi-k3', customModels: [{ id: 'kimi-k3', name: 'Kimi K3' }] });
const mock = config({ id: 'mk', name: '演示（Mock）', kind: 'mock', defaultModelId: 'mock' });
const ready = (providerId: string, value: Partial<ProviderReadiness>): ProviderReadiness => ({ providerId, keyState: 'missing', supported: true, baseUrl: null, models: [], ...value });

function fixture(readiness: ProviderReadiness[]) {
  const records = new Map([deepseek, glm, kimi, mock, old].map(value => [value.id, structuredClone(value)]));
  const api: ProviderSettingsApiContract = {
    listProviderSummaries: vi.fn(async () => [...records.values()].map(summary)),
    getProviderConfiguration: vi.fn(async ({ id }) => structuredClone(records.get(id)!)),
    getProviderKeyState: vi.fn(), getKeyStorageStatus: vi.fn(async () => ({ mode: 'secure', backend: 'f', persistent: true, message: '密钥将使用系统安全存储持久化。' } as const)),
    createProvider: vi.fn(), updateProvider: vi.fn(async input => { const value = { ...records.get(input.id!)!, ...input } as ProviderConfiguration; records.set(value.id, value); return value; }),
    deleteProvider: vi.fn(async () => {}), setKey: vi.fn(), deleteKey: vi.fn(async () => {}),
    testConnection: vi.fn<ProviderSettingsApiContract['testConnection']>(async ({ providerId, level }) => ({ providerId, result: { requestId: 'r', level, ok: true } })),
    listModelReadiness: vi.fn(async () => readiness),
  };
  return { api, records };
}
function show(api: ProviderSettingsApiContract, extra: { section?: SettingsSection } = {}) {
  const providers = [deepseek, glm, kimi, mock, old].map(summary);
  return render(<SettingsPage api={api} providers={providers} providerLoadState="ready" onProvidersChanged={() => {}} theme="system" setTheme={() => {}}
    section={extra.section ?? 'services'} onSection={() => {}} />);
}
const card = (name: string) => screen.getByRole('region', { name });
afterEach(cleanup);

describe('设置 › 模型服务', () => {
  it('states each service in words, as Main decides it (D114)', async () => {
    const { api } = fixture([
      ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('oa', { keyState: 'missing', models: [{ modelId: 'glm-5.3', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] }),
      ready('km', { keyState: 'configured', baseUrl: 'https://api.moonshot.cn/v1', models: [{ modelId: 'kimi-k3', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('mk', { keyState: 'none', models: [{ modelId: 'mock', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
    ]);
    show(api);
    await waitFor(() => expect(within(card('DeepSeek')).getByText('可以使用')).toBeTruthy());
    expect(within(card('智谱 GLM')).getByText('还没填写 Key')).toBeTruthy();
    expect(within(card('Kimi')).getByText('可以使用')).toBeTruthy();
    expect(within(card('演示（Mock）')).getByText('内置')).toBeTruthy();
    // The address is written down, the Key never shown, each model's limits stated.
    await within(card('DeepSeek')).findByText('https://api.deepseek.com');
    expect(card('DeepSeek').textContent).toContain('官方地址');
    expect(card('DeepSeek').textContent).not.toContain('确认');
    expect(card('DeepSeek').textContent).toContain('已保存（不显示）');
    expect(card('DeepSeek').textContent).toContain('上下文 128,000 · 最大输出 8,192');
  });

  it('测试连接 sends one very short message and says what it found', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] })]);
    show(api);
    const deepseekCard = card('DeepSeek');
    const button = await within(deepseekCard).findByRole('button', { name: '测试连接' });
    expect(deepseekCard.textContent).toContain('可能产生极少的费用');
    fireEvent.click(button);
    await within(deepseekCard).findByText(/已收到回复，连接正常/u);
    expect(vi.mocked(api.testConnection).mock.calls.map(([input]) => input.level)).toEqual(['configuration', 'generation']);
    expect(api.testConnection).toHaveBeenLastCalledWith({ providerId: 'ds', level: 'generation', modelId: 'deepseek-flash', allowGeneration: true });
  });

  it('测试连接 says when the Key was refused', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] })]);
    vi.mocked(api.testConnection).mockImplementation(async ({ providerId, level }) => ({ providerId, result: level === 'configuration' ? { requestId: 'r', level, ok: true } : { requestId: 'r', level, ok: false, error: publicError('authentication_failed') } }));
    show(api);
    const deepseekCard = card('DeepSeek');
    fireEvent.click(await within(deepseekCard).findByRole('button', { name: '测试连接' }));
    await within(deepseekCard).findByText(/Key 无效或已过期/u);
    expect(within(deepseekCard).queryByText(/连接正常/u)).toBeNull();
  });

  it('D143 nothing takes an address or a model name; dangerous deletions stay behind a second, red confirmation', async () => {
    const { api } = fixture([ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [] })]);
    show(api);
    const deepseekCard = card('DeepSeek');
    await within(deepseekCard).findByRole('button', { name: '测试连接' });
    for (const name of ['手动添加模型', '从服务商获取列表']) expect(within(deepseekCard).queryByRole('button', { name })).toBeNull();
    expect(within(deepseekCard).queryByLabelText('模型名')).toBeNull();
    expect(within(deepseekCard).queryByLabelText('请求地址')).toBeNull();
    expect(api.updateProvider).not.toHaveBeenCalled();
    fireEvent.click(within(deepseekCard).getByText('高级与删除'));
    fireEvent.click(within(deepseekCard).getByRole('button', { name: '删除 Key…' }));
    expect(api.deleteKey).not.toHaveBeenCalled();
    const confirm = within(deepseekCard).getByRole('button', { name: '确认删除 Key' });
    expect(confirm.className).toContain('is-danger');
    fireEvent.click(confirm);
    await waitFor(() => expect(api.deleteKey).toHaveBeenCalledWith({ providerId: 'ds' }));
  });

  it('D143 a service outside the catalog stays with its name, and only its Key and itself can be removed', async () => {
    const { api } = fixture([ready('old', { supported: false, keyState: 'configured', baseUrl: 'https://models.example/v1', models: [{ modelId: 'old-model', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'disabled' }] })]);
    show(api);
    const oldCard = card('旧服务');
    expect(within(oldCard).getByText('已停用')).toBeTruthy();
    await within(oldCard).findByText(/这个服务已不再支持，可以删除。/u);
    fireEvent.click(within(oldCard).getByRole('button', { name: '展开 旧服务' }));
    await within(oldCard).findByText('https://models.example/v1');
    expect(oldCard.textContent).not.toContain('官方地址');
    expect(within(oldCard).queryByRole('button', { name: '测试连接' })).toBeNull();
    expect(within(oldCard).queryByRole('button', { name: '更换' })).toBeNull();
    expect(within(oldCard).queryByRole('switch')).toBeNull();
    expect(within(oldCard).queryByLabelText('服务名称')).toBeNull();
    expect(within(oldCard).getByRole('button', { name: '删除 Key…' })).toBeTruthy();
    expect(within(oldCard).getByRole('button', { name: '删除服务…' })).toBeTruthy();
  });
});

describe('模型列表的提示', () => {
  it('does not blame the Key when the list was refused, and points at what can tell', () => {
    const text = discoveryText({ outcome: 'authentication_failed', checkedAt: at });
    expect(text).toContain('可能是 Key 的问题，也可能是这家的接口不接受这种访问');
    expect(text).toContain('测试连接');
    expect(discoveryText({ outcome: 'unsupported', checkedAt: at })).toContain('继续用内置列表');
    expect(discoveryText(null)).toContain('内置列表');
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
