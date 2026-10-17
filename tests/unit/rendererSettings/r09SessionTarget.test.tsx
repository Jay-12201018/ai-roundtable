import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsFeature } from '../../../src/renderer/features/settings';
import type { ProviderConfiguration, ProviderKeyState, ProviderSettingsApiContract } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';

afterEach(cleanup);
const storage = { mode: 'memory', backend: 'fixture', persistent: false, message: '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' } as const;
const configuration: ProviderConfiguration = { id: 'p', name: 'Fixture', kind: 'openai', baseUrl: null, enabled: true, isDefault: false, defaultModelId: 'manual-model', customModels: [], keyReference: null, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' };
function fixture() {
  let key: ProviderKeyState = { providerId: 'p', state: 'missing', keyReference: null, storage };
  const api: ProviderSettingsApiContract = {
    listProviderSummaries: vi.fn<ProviderSettingsApiContract['listProviderSummaries']>(async () => [{ id: 'p', name: 'Fixture', kind: 'openai', enabled: true, isDefault: false, defaultModelId: 'manual-model', customModels: [], configurationValid: true, hasStoredKey: false }]),
    getProviderConfiguration: vi.fn(async () => configuration),
    getProviderKeyState: vi.fn(async () => key), getKeyStorageStatus: vi.fn(async () => storage),
    createProvider: vi.fn(async () => configuration), updateProvider: vi.fn(async () => configuration), deleteProvider: vi.fn(async () => {}),
    confirmTarget: vi.fn(async ({ providerId }) => ({ providerId })),
    setKey: vi.fn(async () => (key = { providerId: 'p', state: 'session', keyReference: { id: 'fake-reference' }, storage })),
    deleteKey: vi.fn(async () => { key = { providerId: 'p', state: 'missing', keyReference: null, storage }; }),
    listModels: vi.fn(async ({ providerId }) => ({ providerId, models: [{ id: 'listed', name: 'Listed' }] })),
    testConnection: vi.fn<ProviderSettingsApiContract['testConnection']>(async ({ providerId, level }) => ({ providerId, result: level === 'configuration' ? { requestId: 'local-request', level, ok: true } : { requestId: 'rejected-request', level, ok: false, error: publicError('unsupported') } })),
  };
  return api;
}
async function open(api: ProviderSettingsApiContract) {
  const view = render(<SettingsFeature api={api} onClose={vi.fn()} />);
  await screen.findByLabelText('Provider 名称'); return view;
}
const tickTarget = () => fireEvent.click(screen.getByLabelText('我已核对请求目标'));

it('shows the exact official default and confirms a saved target explicitly without a network operation', async () => {
  const api = fixture(); await open(api);
  expect(screen.getByText('https://api.openai.com/v1')).toBeTruthy();
  const confirm = screen.getByRole('button', { name: '确认本次会话目标' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true); tickTarget(); fireEvent.click(confirm);
  expect(await screen.findByText('本次会话请求目标已确认；更换 Key 或目标后需重新确认。')).toBeTruthy();
  expect(api.confirmTarget).toHaveBeenCalledWith({ providerId: 'p', baseUrl: 'https://api.openai.com/v1', confirmed: true });
  expect(api.listModels).not.toHaveBeenCalled(); expect(api.testConnection).not.toHaveBeenCalled();
});

it('keeps configuration local and waits for current target approval before fetching models', async () => {
  const api = fixture(); await open(api);
  fireEvent.click(screen.getByRole('button', { name: '检查配置' }));
  expect(await screen.findByText('配置检查：通过（仅本地配置）')).toBeTruthy();
  expect(api.confirmTarget).not.toHaveBeenCalled();
  let release!: (value: { providerId: string }) => void;
  api.confirmTarget = vi.fn<ProviderSettingsApiContract['confirmTarget']>(() => new Promise(resolve => { release = resolve; }));
  tickTarget(); fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));
  await waitFor(() => expect(api.confirmTarget).toHaveBeenCalled());
  expect(api.listModels).not.toHaveBeenCalled();
  await act(async () => release({ providerId: 'p' }));
  expect(await screen.findByText('Listed · listed')).toBeTruthy();
});

it('clears target approval after saving or deleting a Key and sends explicit generation consent', async () => {
  const api = fixture(); await open(api); tickTarget();
  const secret = screen.getByLabelText('API Key', { selector: 'input' }) as HTMLInputElement;
  fireEvent.change(secret, { target: { value: 'fake-ui-key' } }); fireEvent.submit(secret.closest('form')!);
  expect(await screen.findByText('Key 已保存。')).toBeTruthy();
  expect((screen.getByLabelText('我已核对请求目标') as HTMLInputElement).checked).toBe(false);
  expect(secret.value).toBe('');
  tickTarget(); fireEvent.click(screen.getByLabelText('我确认本次生成测试可能产生费用'));
  fireEvent.click(screen.getByRole('button', { name: '发起生成测试' }));
  expect(await screen.findByText(/生成测试：当前目标或模型缺少已确认的能力、计数或预算信息/)).toBeTruthy();
  expect(api.testConnection).toHaveBeenLastCalledWith({ providerId: 'p', level: 'generation', modelId: 'manual-model', allowGeneration: true });
  fireEvent.click(screen.getByRole('button', { name: '删除 Key' })); fireEvent.click(screen.getByRole('button', { name: '确认删除 Key' }));
  expect(await screen.findByText('Key 已删除。')).toBeTruthy();
  expect((screen.getByLabelText('我已核对请求目标') as HTMLInputElement).checked).toBe(false);
});

it('does not dispatch generation if the settings session closes while target approval is pending', async () => {
  const api = fixture(); let release!: (value: { providerId: string }) => void;
  api.confirmTarget = vi.fn<ProviderSettingsApiContract['confirmTarget']>(() => new Promise(resolve => { release = resolve; }));
  await open(api); tickTarget(); fireEvent.click(screen.getByLabelText('我确认本次生成测试可能产生费用'));
  fireEvent.click(screen.getByRole('button', { name: '发起生成测试' }));
  await waitFor(() => expect(api.confirmTarget).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '返回讨论' }));
  await act(async () => release({ providerId: 'p' }));
  expect(api.testConnection).not.toHaveBeenCalled();
});
