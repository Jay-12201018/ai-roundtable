import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsFeature } from '../../../src/renderer/features/settings';
import type { ProviderConfiguration, ProviderKeyState, ProviderSettingsApiContract } from '../../../src/shared/contracts/configuration';
import { ContractError } from '../../../src/shared/contracts/errors';
import { publicError } from '../../../src/shared/schemas/error';

const memory = { mode: 'memory', backend: 'fixture', persistent: false, message: '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' } as const;
const secure = { mode: 'secure', backend: 'fixture', persistent: true, message: '密钥将使用系统安全存储持久化。' } as const;
const base: ProviderConfiguration = {
  id: 'one', name: '工作端点', kind: 'openai-compatible', baseUrl: 'https://one.example/v1',
  enabled: true, isDefault: false, defaultModelId: 'model-one', customModels: [{ id: 'model-one', name: '自定义模型' }],
  keyReference: null, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
};

function fixture(configurations: ProviderConfiguration[] = [base]) {
  const records = new Map(configurations.map(p => [p.id, structuredClone(p)]));
  const keyStates = new Map<string, ProviderKeyState>();
  const keyState = (providerId: string): ProviderKeyState => keyStates.get(providerId) ?? { providerId, state: 'missing', keyReference: null, storage: memory };
  const api: ProviderSettingsApiContract = {
    confirmTarget: vi.fn(async ({providerId})=>({providerId})),
    listProviderSummaries: vi.fn(async () => [...records.values()].map(({ id, name, kind, enabled, isDefault, defaultModelId, customModels }) => ({ id, name, kind, enabled, isDefault, defaultModelId, customModels, configurationValid: true, hasStoredKey: false }))),
    getProviderConfiguration: vi.fn(async ({ id }) => structuredClone(records.get(id)!)),
    getProviderKeyState: vi.fn(async ({ providerId }) => keyState(providerId)),
    getKeyStorageStatus: vi.fn(async () => memory),
    createProvider: vi.fn(async input => {
      const value = { ...base, ...input, id: `created-${records.size}`, keyReference: null } as ProviderConfiguration;
      records.set(value.id, value); return value;
    }),
    updateProvider: vi.fn(async input => {
      const previous = records.get(input.id)!;
      const value = { ...previous, ...input };
      records.set(value.id, value); return value;
    }),
    deleteProvider: vi.fn(async ({ id }) => { records.delete(id); }),
    setKey: vi.fn(async ({ providerId }) => {
      const value: ProviderKeyState = { providerId, state: 'session', keyReference: { id: 'session-reference' }, storage: memory };
      keyStates.set(providerId, value); return value;
    }),
    deleteKey: vi.fn(async ({ providerId }) => { keyStates.delete(providerId); }),
    listModels: vi.fn(async ({ providerId }) => ({ providerId, models: [{ id: 'remote-model', name: '列表模型' }] })),
    testConnection: vi.fn<ProviderSettingsApiContract['testConnection']>(async ({ providerId, level }) => ({ providerId, result: level === 'configuration'
      ? { requestId: 'fixture-request', level, ok: true }
      : { requestId: 'fixture-request', level, ok: false, error: publicError('unsupported') } })),
  };
  return { api, records, keyStates };
}

async function open(api: ProviderSettingsApiContract) {
  const onClose = vi.fn();
  const view = render(<SettingsFeature api={api} onClose={onClose} />);
  await screen.findByLabelText('Provider 名称');
  return { ...view, onClose };
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { selector: 'input,select' }), { target: { value } }); }
function keyInput() { return screen.getByLabelText('API Key', { selector: 'input' }) as HTMLInputElement; }
function confirmTarget() { fireEvent.click(screen.getByLabelText('我已核对请求目标')); }

afterEach(cleanup);

describe('R08 standalone settings interactions', () => {
  it('creates another instance of the same kind and saves custom models, enabled and default fields', async () => {
    const { api } = fixture(); await open(api);
    fireEvent.click(screen.getByRole('button', { name: '新增 Provider' }));
    fill('Provider 名称', '第二个工作端点'); fill('Base URL', 'https://two.example/v1');
    fill('新增模型 ID', 'custom-two'); fill('新增模型名称', '第二模型');
    fireEvent.click(screen.getByRole('button', { name: '添加自定义模型' }));
    fill('默认模型 ID', 'custom-two');
    fireEvent.click(screen.getByLabelText('设为默认 Provider'));
    confirmTarget(); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(api.createProvider).toHaveBeenCalledWith({ name: '第二个工作端点', kind: 'openai-compatible', baseUrl: 'https://two.example/v1', enabled: true, isDefault: true, defaultModelId: 'custom-two', customModels: [{ id: 'custom-two', name: '第二模型' }] }));
    expect(await screen.findByRole('button', { name: /第二个工作端点/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^工作端点 ·/ })).toBeTruthy();
  });

  it('edits model identity/name/default, disables a provider and explicitly confirms deletion', async () => {
    const { api } = fixture(); await open(api);
    fill('模型 1 ID', 'edited-model'); fill('模型 1 名称', '修改名称'); fill('默认模型 ID', 'edited-model');
    fireEvent.click(screen.getByLabelText('启用此 Provider'));
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(api.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'one', enabled: false, customModels: [{ id: 'edited-model', name: '修改名称' }], defaultModelId: 'edited-model' })));
    fireEvent.click(screen.getByRole('button', { name: '删除 Provider' }));
    expect(api.deleteProvider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除 Provider' }));
    await waitFor(() => expect(api.deleteProvider).toHaveBeenCalledWith({ id: 'one' }));
  });

  it('requires the normalized changed target and key reentry warning before saving', async () => {
    const { api } = fixture(); await open(api);
    fill('Base URL', 'https://NEW.example/v1');
    expect(screen.getByText(/更换类型或请求目标会撤销旧 Key/)).toBeTruthy();
    expect(screen.getByText('https://new.example/v1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(api.updateProvider).not.toHaveBeenCalled();
    confirmTarget(); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(api.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://new.example/v1' })));
  });

  it('rejects credential-bearing and deceptive loopback endpoints without echoing their value', async () => {
    const { api } = fixture(); await open(api);
    fill('Base URL', 'https://user:DO-NOT-ECHO@example.test/v1');
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(api.updateProvider).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).not.toContain('DO-NOT-ECHO');
    fill('Base URL', 'http://localhost.attacker.test/v1');
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(api.updateProvider).not.toHaveBeenCalled();
  });

  it('clears the DOM secret immediately, prevents duplicate saves and shows session-only status', async () => {
    const { api } = fixture(); let resolve!: (state: ProviderKeyState) => void;
    api.setKey = vi.fn(() => new Promise<ProviderKeyState>(r => { resolve = r; }));
    await open(api); confirmTarget(); fill('API Key', 'fixture-secret-never-persist');
    const input = keyInput() as HTMLInputElement;
    const form = input.closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(input.value).toBe('');
    expect(api.setKey).toHaveBeenCalledTimes(1);
    expect(api.setKey).toHaveBeenCalledWith({ providerId: 'one', apiKey: 'fixture-secret-never-persist' });
    expect(localStorage.length).toBe(0);
    await act(async () => resolve({ providerId: 'one', state: 'session', keyReference: { id: 'reference' }, storage: memory }));
    expect(await screen.findByText('本次会话有效；退出后需重新输入 Key。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('fixture-secret-never-persist');
  });

  it('replaces a protected key and deletes it without showing its reference or plaintext', async () => {
    const { api, keyStates } = fixture();
    keyStates.set('one', { providerId: 'one', state: 'configured', keyReference: { id: 'private-ref' }, storage: secure });
    api.setKey = vi.fn<ProviderSettingsApiContract['setKey']>(async () => ({ providerId: 'one', state: 'configured', keyReference: { id: 'replacement-ref' }, storage: secure }));
    await open(api); expect(screen.getByText('已配置；系统安全存储。')).toBeTruthy();
    confirmTarget(); fill('API Key', 'replacement-fixture');
    fireEvent.submit(keyInput().closest('form')!);
    await waitFor(() => expect(api.setKey).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '删除 Key' }));
    expect(api.deleteKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除 Key' }));
    await waitFor(() => expect(api.deleteKey).toHaveBeenCalledWith({ providerId: 'one' }));
    expect(await screen.findByText('未配置 Key。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private-ref');
    expect(document.body.textContent).not.toContain('replacement-ref');
  });

  it('clears input on blur, cancellation, switching and closing', async () => {
    const { api } = fixture([base, { ...base, id: 'two', name: '备用端点' }]);
    const { onClose } = await open(api); confirmTarget();
    fill('API Key', 'blur-secret'); fireEvent.blur(keyInput());
    expect((keyInput() as HTMLInputElement).value).toBe('');
    fill('API Key', 'cancel-secret'); fireEvent.click(screen.getByRole('button', { name: '清除输入' }));
    expect((keyInput() as HTMLInputElement).value).toBe('');
    fill('API Key', 'switch-secret'); fireEvent.click(screen.getByRole('button', { name: /备用端点/ }));
    await waitFor(() => expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('备用端点'));
    expect((keyInput() as HTMLInputElement).value).toBe('');
    confirmTarget(); fill('API Key', 'close-secret'); const input = keyInput();
    fireEvent.click(screen.getByRole('button', { name: '返回讨论' }));
    expect(input.value).toBe('');
    expect(onClose).toHaveBeenCalledOnce(); expect(api.setKey).not.toHaveBeenCalled();
  });

  it('isolates late key responses after switching instances', async () => {
    const { api } = fixture([base, { ...base, id: 'two', name: '备用端点' }]);
    let resolve!: (state: ProviderKeyState) => void;
    api.setKey = vi.fn(() => new Promise<ProviderKeyState>(r => { resolve = r; }));
    await open(api); confirmTarget(); fill('API Key', 'late-secret');
    fireEvent.submit(keyInput().closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: /备用端点/ }));
    await waitFor(() => expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('备用端点'));
    await act(async () => resolve({ providerId: 'one', state: 'session', keyReference: { id: 'reference' }, storage: memory }));
    expect(screen.getByText('未配置 Key。')).toBeTruthy();
    expect(screen.queryByText('Key 已保存。')).toBeNull();
  });

  it('clears a detached secret input on unmount and ignores its pending key result', async () => {
    const { api } = fixture();
    const { unmount } = await open(api); confirmTarget();
    fill('API Key', 'unmount-fixture-secret');
    const input = keyInput();
    unmount();
    expect(input.value).toBe('');
    expect(api.setKey).not.toHaveBeenCalled();
  });

  it('ignores a slow configuration response from a previously selected instance', async () => {
    const { api } = fixture([base, { ...base, id: 'two', name: '备用端点' }]);
    let resolve!: (value: ProviderConfiguration) => void;
    api.getProviderConfiguration = vi.fn<ProviderSettingsApiContract['getProviderConfiguration']>(({ id }) => id === 'one' ? new Promise(r => { resolve = r; }) : Promise.resolve({ ...base, id: 'two', name: '备用端点' }));
    render(<SettingsFeature api={api} onClose={vi.fn()} />);
    await screen.findByText('正在加载 Provider…');
    fireEvent.click(screen.getByRole('button', { name: /备用端点/ }));
    await waitFor(() => expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('备用端点'));
    await act(async () => resolve(base));
    expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('备用端点');
  });

  it('keeps model-list, configuration, authentication and generation outcomes separate', async () => {
    const { api } = fixture(); await open(api); confirmTarget();
    expect(api.testConnection).not.toHaveBeenCalled(); expect(api.listModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));
    expect(await screen.findByText('列表模型 · remote-model')).toBeTruthy();
    expect(api.testConnection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '检查配置' }));
    expect(await screen.findByText('配置检查：通过（仅本地配置）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '测试鉴权' }));
    expect(await screen.findByText('鉴权测试：当前目标或模型缺少已确认的能力、计数或预算信息。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发起生成测试' }));
    expect(api.testConnection).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText('我确认本次生成测试可能产生费用'));
    fireEvent.click(screen.getByRole('button', { name: '发起生成测试' }));
    expect(await screen.findByText('生成测试：当前目标或模型缺少已确认的能力、计数或预算信息。')).toBeTruthy();
    expect(api.testConnection).toHaveBeenLastCalledWith({ providerId: 'one', level: 'generation', modelId: 'model-one', allowGeneration: true });
    expect(screen.getByText('配置检查：通过（仅本地配置）')).toBeTruthy();
  });

  it('never echoes backend errors containing the input secret and retains a useful fixed error', async () => {
    const { api } = fixture(); api.setKey = vi.fn().mockRejectedValue(new Error('LEAK-IN-BACKEND fixture-secret'));
    await open(api); confirmTarget(); fill('API Key', 'fixture-secret');
    fireEvent.submit(keyInput().closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('操作失败，请重试。'));
    expect(document.body.textContent).not.toContain('LEAK-IN-BACKEND');
    expect(document.body.textContent).not.toContain('fixture-secret');
    expect((keyInput() as HTMLInputElement).value).toBe('');
  });

  it('shows fixed active-reference failure without losing the draft or sending secret config fields', async () => {
    const { api } = fixture(); api.updateProvider = vi.fn().mockRejectedValue(new ContractError('invalid_state'));
    await open(api); fill('Provider 名称', '保留草稿');
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '当前状态不允许此操作；请先结束相关运行或检查引用。');
    expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('保留草稿');
    const payload = vi.mocked(api.updateProvider).mock.calls[0][0];
    expect(payload).not.toHaveProperty('keyReference'); expect(payload).not.toHaveProperty('apiKey');
  });

  it('offers a useful empty state and a retry after initial loading fails', async () => {
    const { api } = fixture([]); api.listProviderSummaries = vi.fn().mockRejectedValueOnce(new ContractError('transport_error')).mockResolvedValue([]);
    render(<SettingsFeature api={api} onClose={vi.fn()} />);
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('还没有 Provider，添加一个配置开始。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新增 Provider' }));
    expect(await screen.findByLabelText('Provider 名称')).toBeTruthy();
  });

  it('does not replace a new draft when the initial provider list arrives late', async () => {
    const { api } = fixture(); let release!: () => void;
    const list = api.listProviderSummaries;
    api.listProviderSummaries = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return list(); });
    render(<SettingsFeature api={api} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增 Provider' }));
    fill('Provider 名称', '初始加载期间填写的草稿');
    await act(async () => release());
    expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('初始加载期间填写的草稿');
  });

  it('isolates a pending mutation when a new API instance replaces the current session', async () => {
    const first = fixture(); const second = fixture([{ ...base, name: '新 API 配置' }]);
    let finish!: (value: ProviderConfiguration) => void;
    let releaseList!: () => void; const secondList = second.api.listProviderSummaries;
    second.api.listProviderSummaries = vi.fn(async () => { await new Promise<void>(resolve => { releaseList = resolve; }); return secondList(); });
    first.api.updateProvider = vi.fn(() => new Promise<ProviderConfiguration>(resolve => { finish = resolve; }));
    const view = await open(first.api);
    fill('Provider 名称', '旧 API 保存结果'); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    view.rerender(<SettingsFeature api={second.api} onClose={view.onClose} />);
    await waitFor(() => expect(second.api.listProviderSummaries).toHaveBeenCalledOnce());
    await act(async () => finish({ ...base, name: '旧 API 保存结果' }));
    await act(async () => releaseList());
    await waitFor(() => expect((screen.getByLabelText('Provider 名称') as HTMLInputElement).value).toBe('新 API 配置'));
    expect(screen.queryByText('配置已保存。')).toBeNull();
    expect(first.api.listProviderSummaries).toHaveBeenCalledOnce();
  });

  it('allows explicit protected deletion of an unreadable legacy configuration and preserves refusal errors', async () => {
    const { api } = fixture(); const list = api.listProviderSummaries;
    api.listProviderSummaries = vi.fn(async () => (await list()).map(provider => ({ ...provider, configurationValid: false })));
    api.getProviderConfiguration = vi.fn().mockRejectedValue(new ContractError('invalid_input'));
    const remove = api.deleteProvider;
    api.deleteProvider = vi.fn().mockRejectedValueOnce(new ContractError('invalid_state')).mockImplementation(remove);
    render(<SettingsFeature api={api} onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /需要修复/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除 Provider' }));
    expect(api.deleteProvider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除 Provider' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '当前状态不允许此操作；请先结束相关运行或检查引用。');
    expect(screen.getByRole('button', { name: /需要修复/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认删除 Provider' }));
    await waitFor(() => expect(api.deleteProvider).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('还没有 Provider，添加一个配置开始。')).toBeTruthy();
    expect(api.deleteProvider).toHaveBeenLastCalledWith({ id: 'one' });
  });
});
