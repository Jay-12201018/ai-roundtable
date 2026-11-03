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
const ready = (providerId: string, value: Partial<ProviderReadiness>): ProviderReadiness => ({ providerId, keyState: 'missing', baseUrl: null, models: [], ...value });

function fixture(readiness: ProviderReadiness[]) {
  const records = new Map([deepseek, openai, kimi, mock].map(value => [value.id, structuredClone(value)]));
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
function show(api: ProviderSettingsApiContract, extra: { section?: SettingsSection; network?: NetworkApiContract } = {}) {
  const providers = [deepseek, openai, kimi, mock].map(summary);
  return render(<SettingsPage api={api} providers={providers} providerLoadState="ready" onProvidersChanged={() => {}} theme="system" setTheme={() => {}}
    section={extra.section ?? 'services'} onSection={() => {}} network={extra.network} />);
}
const card = (name: string) => screen.getByRole('region', { name });
afterEach(cleanup);

describe('设置 › 模型服务', () => {
  it('states each service in words, as Main decides it (D114)', async () => {
    const { api } = fixture([
      ready('ds', { keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('oa', { keyState: 'missing', models: [{ modelId: 'gpt-4o-mini', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] }),
      ready('km', { keyState: 'configured', baseUrl: 'https://kimi.example/v1', models: [{ modelId: 'moonshot', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
      ready('mk', { keyState: 'none', models: [{ modelId: 'mock', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }),
    ]);
    show(api);
    await waitFor(() => expect(within(card('DeepSeek')).getByText('可以使用')).toBeTruthy());
    expect(within(card('OpenAI')).getByText('还没填写 Key')).toBeTruthy();
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

describe('设置 › 网络 (D137)', () => {
  const base: NetworkSettings = { saved: { enabled: false, manual: null }, status: { state: 'off' }, savedInvalid: false };
  const network = (value: NetworkSettings, status: NetworkSettings['status'] = { state: 'proxy', source: 'system', host: '127.0.0.1', port: 7890 }) => ({
    getSettings: vi.fn(async () => value),
    saveSettings: vi.fn(async (input: NetworkSettings['saved']) => ({ ...value, saved: input, status: input.enabled ? status : { state: 'off' as const } })),
    testProxy: vi.fn(async () => ({ ok: false, via: 'direct', failure: 'refused' } as const)),
  });
  const open = async (net: ReturnType<typeof network>) => {
    const { api } = fixture([]);
    show(api, { section: 'network', network: net as unknown as NetworkApiContract });
    return screen.findByRole('switch', { name: '使用系统代理' });
  };

  it('starts off, and one switch reads the system setting; there is nothing to restart', async () => {
    const net = network(base);
    const toggle = await open(net);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('未开启，直接连接。')).toBeTruthy();
    fireEvent.click(toggle);
    await screen.findByText('已检测到系统代理 127.0.0.1:7890');
    expect(net.saveSettings).toHaveBeenCalledWith({ enabled: true, manual: null });
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/重启/u);
  });

  it.each([
    [{ state: 'direct' } as const, '系统没有设置代理，将直接连接。'],
    [{ state: 'unsupported', scheme: 'socks' } as const, '系统代理是 SOCKS，这个应用现在不支持，请求不会发出。可以在高级选项里手动填写 HTTP 代理地址。'],
    [{ state: 'proxy', source: 'manual', host: '10.0.0.2', port: 3128 } as const, '使用手动填写的代理 10.0.0.2:3128'],
  ])('says what the switch found: %j', async (status, words) => {
    await open(network({ ...base, saved: { enabled: true, manual: status.state === 'proxy' ? { host: status.host, port: status.port } : null }, status }));
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('tests the connection with what is saved and says what happened, in neutral words', async () => {
    const net = network(base);
    await open(net);
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByText('连接不上，请检查网络和地址。');
    expect(net.testProxy).toHaveBeenCalledWith({ enabled: false, manual: null });
    net.testProxy.mockResolvedValueOnce({ ok: true, via: 'direct' } as never);
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByText('连接正常。');
  });

  it('keeps the manual address under 高级, checks its form and clears it', async () => {
    const net = network(base);
    await open(net);
    fireEvent.click(screen.getByText('高级：手动填写地址'));
    fireEvent.change(screen.getByLabelText('代理地址'), { target: { value: '127.0.0.1' } });
    fireEvent.change(screen.getByLabelText('端口'), { target: { value: '99999' } });
    expect(screen.getByRole('alert').textContent).toContain('填写代理的地址和端口');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('端口'), { target: { value: '7890' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(net.saveSettings).toHaveBeenCalledWith({ enabled: false, manual: { host: '127.0.0.1', port: 7890 } }));
    fireEvent.click(await screen.findByRole('button', { name: '清除' }));
    await waitFor(() => expect(net.saveSettings).toHaveBeenLastCalledWith({ enabled: false, manual: null }));
  });

  it('names no proxy software and no reason for using one', async () => {
    await open(network(base));
    expect(document.body.textContent).toContain('如果你的网络环境需要通过代理连接，在这里打开。');
    expect(document.body.textContent).not.toMatch(/Clash|Surge|V2Ray|VPN|梯子|翻墙|海外|Fake-IP/iu);
  });
});
