import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsFeature } from '../../../src/renderer/features/settings';
import type { ProviderConfiguration, ProviderKeyState, ProviderSettingsApiContract } from '../../../src/shared/contracts/configuration';

const secure = { mode: 'secure', backend: 'fixture', persistent: true, message: '密钥将使用系统安全存储持久化。' } as const;
const deepSeek: ProviderConfiguration = {
  id: 'ds', name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/', enabled: true, isDefault: true,
  defaultModelId: 'deepseek-flash', customModels: [], keyReference: null, createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z',
};
// Synthetic look-alike, never a real credential.
const pastedKey = 'sk-0123456789abcdef0123456789abcdef';

function fixture(configuration: ProviderConfiguration | null = deepSeek, initial: Partial<ProviderKeyState> = {}) {
  const records = new Map(configuration ? [[configuration.id, structuredClone(configuration)]] : []);
  let key: ProviderKeyState = { providerId: 'ds', state: 'missing', keyReference: null, storage: secure, ...initial };
  let confirmed = initial.sessionTargetConfirmed ?? false;
  const api: ProviderSettingsApiContract = {
    confirmTarget: vi.fn(async ({ providerId }) => { confirmed = true; return { providerId }; }),
    listProviderSummaries: vi.fn(async () => [...records.values()].map(({ id, name, kind, enabled, isDefault, defaultModelId, customModels }) => ({ id, name, kind, enabled, isDefault, defaultModelId, customModels, configurationValid: true, hasStoredKey: key.state !== 'missing' }))),
    getProviderConfiguration: vi.fn(async ({ id }) => structuredClone(records.get(id)!)),
    getProviderKeyState: vi.fn(async ({ providerId }) => ({ ...key, providerId, sessionTargetConfirmed: confirmed })),
    getKeyStorageStatus: vi.fn(async () => secure),
    createProvider: vi.fn(async input => { const value = { ...deepSeek, ...input, id: 'ds', keyReference: null } as ProviderConfiguration; records.set('ds', value); return value; }),
    updateProvider: vi.fn(async input => { const value = { ...records.get(input.id)!, ...input } as ProviderConfiguration; records.set(value.id, value); return value; }),
    deleteProvider: vi.fn(async () => {}),
    setKey: vi.fn(async ({ providerId }) => { confirmed = false; key = { providerId, state: 'configured', keyReference: { id: 'ref' }, storage: secure }; return key; }),
    deleteKey: vi.fn(async () => {}),
    listModels: vi.fn(async ({ providerId }) => ({ providerId, models: [] })),
    testConnection: vi.fn(),
  };
  return { api };
}
async function open(api: ProviderSettingsApiContract) {
  render(<SettingsFeature api={api} onClose={() => {}} />);
  await screen.findByLabelText('Provider 名称');
}
const keyInput = () => screen.getByLabelText('API Key', { selector: 'input' }) as HTMLInputElement;
const progress = () => screen.getByRole('region', { name: '接入进度' }).textContent!;
afterEach(cleanup);

describe('D096 an API Key typed into a model field', () => {
  it('is flagged at once with a clear Chinese hint and never saved as a model ID', async () => {
    const { api } = fixture();
    await open(api);
    expect(document.getElementById('settings-default-model-help')!.textContent).toBe('例如 deepseek-flash');
    expect((screen.getByLabelText('默认模型 ID') as HTMLInputElement).placeholder).toBe('例如 deepseek-flash');
    fireEvent.change(screen.getByLabelText('默认模型 ID'), { target: { value: pastedKey } });
    const alert = screen.getByText(/这看起来是 API Key，不是模型 ID/u);
    expect(alert.textContent).toContain('请把它填到下方的“API Key”输入框');
    expect(screen.getByLabelText('默认模型 ID').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(api.updateProvider).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').some(node => node.textContent!.includes('这看起来是 API Key'))).toBe(true);
  });

  it('blocks a key-like custom model and generation test model too', async () => {
    const { api } = fixture();
    await open(api);
    fireEvent.change(screen.getByLabelText('新增模型 ID'), { target: { value: pastedKey } });
    fireEvent.change(screen.getByLabelText('新增模型名称'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '添加自定义模型' }));
    expect(screen.queryByLabelText('模型 1 ID')).toBeNull();
    fireEvent.change(screen.getByLabelText('生成测试模型 ID'), { target: { value: pastedKey } });
    fireEvent.click(screen.getByLabelText('我确认本次生成测试可能产生费用'));
    expect((screen.getByRole('button', { name: '发起生成测试' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('tells the user when Main withheld an older key-like model ID', async () => {
    const { api } = fixture({ ...deepSeek, defaultModelId: null, withheldModelIds: true });
    await open(api);
    expect(screen.getByText(/之前保存的模型 ID 里有看起来像 API Key 的内容，已隐藏/u)).toBeTruthy();
  });
});

describe('D097 the Key input says why it is unavailable and offers the fix next to it', () => {
  it('after saving, explains the target check beside the disabled input and enables it in one click', async () => {
    const { api } = fixture();
    await open(api);
    expect(keyInput().disabled).toBe(true);
    const reason = document.getElementById('settings-key-blocked')!;
    expect(reason.textContent).toContain('输入框暂不可用：填写 Key 之前，请先核对 Key 将发往的请求目标：https://api.deepseek.com/');
    expect(keyInput().getAttribute('aria-describedby')).toContain('settings-key-blocked');
    fireEvent.click(screen.getByRole('button', { name: '目标无误，启用输入框' }));
    await waitFor(() => expect(keyInput().disabled).toBe(false));
    expect(document.activeElement).toBe(keyInput());
    expect((screen.getByLabelText('我已核对请求目标') as HTMLInputElement).checked).toBe(true);
    expect(document.getElementById('settings-key-blocked')).toBeNull();
  });

  it('with unsaved changes, says so and saves from the same place', async () => {
    const { api } = fixture();
    await open(api);
    fireEvent.change(screen.getByLabelText('Provider 名称'), { target: { value: 'DeepSeek 直连' } });
    expect(document.getElementById('settings-key-blocked')!.textContent).toContain('配置有未保存的更改，保存后才能填写 Key');
    expect(progress()).toContain('下一步：保存配置。');
    fireEvent.click(screen.getByRole('button', { name: '先保存配置' }));
    await waitFor(() => expect(api.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'DeepSeek 直连' })));
  });

  it('walks the whole flow on one screen: Key, then the session target, with progress that matches Main', async () => {
    const { api } = fixture();
    await open(api);
    expect(progress()).toContain('API Key：未配置');
    expect(progress()).toContain('本次会话目标：未确认');
    fireEvent.click(screen.getByRole('button', { name: '目标无误，启用输入框' }));
    await waitFor(() => expect(keyInput().disabled).toBe(false));
    fireEvent.change(keyInput(), { target: { value: 'fixture-key' } });
    fireEvent.submit(keyInput().closest('form')!);
    await screen.findByText('Key 已保存。');
    expect(progress()).toContain('API Key：已配置');
    expect(progress()).toContain('下一步：确认本次会话目标。');
    // The last step sits under the Key, names the target and needs one deliberate click.
    const last = screen.getByText(/最后一步：确认本次会话的请求目标 https:\/\/api\.deepseek\.com\//u);
    expect(last).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '目标无误，确认本次会话' })); });
    expect(api.confirmTarget).toHaveBeenCalledWith({ providerId: 'ds', baseUrl: 'https://api.deepseek.com/', confirmed: true });
    await waitFor(() => expect(progress()).toContain('本次会话目标：已确认'));
    expect(progress()).toContain('已就绪');
    expect(screen.queryByRole('button', { name: '目标无误，确认本次会话' })).toBeNull();
  });

  it('reads the session confirmation from Main instead of assuming it after a reload', async () => {
    const { api } = fixture(deepSeek, { state: 'configured', keyReference: { id: 'ref' }, sessionTargetConfirmed: true });
    await open(api);
    expect(progress()).toContain('本次会话目标：已确认');
    expect(screen.queryByText(/最后一步/u)).toBeNull();
  });
});
