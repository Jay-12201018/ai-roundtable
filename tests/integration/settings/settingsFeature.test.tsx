import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderSettingsService } from '../../../src/main/settings';
import { SettingsFeature } from '../../../src/renderer/features/settings';

const databases: Database[] = [];
afterEach(() => { cleanup(); databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  const keys = new KeyService(database, createMemoryKeyBackend());
  const api = new ProviderSettingsService(database, keys);
  return { database, keys, api };
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

it('connects the standalone feature to the actual settings service, Database and memory-only Key lifecycle', async () => {
  const { database, api, keys } = fixture();
  render(<SettingsFeature api={api} onClose={() => {}} />);
  await screen.findByText('还没有 Provider，添加一个配置开始。');
  fireEvent.click(screen.getByRole('button', { name: '新增 Provider' }));
  fill('Provider 名称', '集成测试端点'); fill('Base URL', 'http://localhost:11434/v1');
  fill('默认模型 ID', 'local-model');
  fireEvent.click(screen.getByLabelText('我已核对请求目标'));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByRole('heading', { name: '编辑 Provider' });
  const provider = database.listProviderSummaries()[0];
  expect(provider).toMatchObject({ name: '集成测试端点', kind: 'openai-compatible', defaultModelId: 'local-model' });
  fireEvent.click(screen.getByLabelText('我已核对请求目标'));
  const secret = screen.getByLabelText('API Key', { selector: 'input' }) as HTMLInputElement;
  fireEvent.change(secret, { target: { value: 'fixture-integration-key' } });
  fireEvent.submit(secret.closest('form')!);
  expect(secret.value).toBe('');
  await screen.findByText('本次会话有效；退出后需重新输入 Key。');
  const prior = await keys.getProviderKeyState(provider.id);
  expect(database.getProviderConfiguration(provider.id)?.keyReference).toBeNull();
  expect(database.rawKeyRecord(prior.keyReference!.id)).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '检查配置' }));
  await screen.findByText('配置检查：通过（仅本地配置）');
  fireEvent.click(screen.getByRole('button', { name: '测试鉴权' }));
  await screen.findByText('鉴权测试：真实连接能力尚未接入。');
  fill('Base URL', 'https://other.example.test/v1');
  fireEvent.click(screen.getByLabelText('我已核对请求目标'));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('未配置 Key。');
  expect(await keys.resolveKey(provider.id, prior.keyReference!)).toBeUndefined();
  expect(document.body.textContent).not.toContain('fixture-integration-key');
  expect(localStorage.length).toBe(0);
});

it('shows the real reference-protection failure and keeps the Provider and Key usable', async () => {
  const { database, api, keys } = fixture();
  const provider = await api.createProvider({ name: '被引用的端点', kind: 'openai' });
  const key = await api.setKey({ providerId: provider.id, apiKey: 'fixture-protected-key' });
  database.createRoom({ id: 'r', name: 'R' });
  database.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'draft', providerId: provider.id, modelId: 'custom' });
  render(<SettingsFeature api={api} onClose={() => {}} />);
  await screen.findByLabelText('Provider 名称');
  fireEvent.click(screen.getByRole('button', { name: '删除 Provider' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 Provider' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('检查引用');
  expect(database.getProviderConfiguration(provider.id)?.id).toBe(provider.id);
  expect(await keys.resolveKey(provider.id, key.keyReference!)).toBe('fixture-protected-key');
  fireEvent.click(screen.getByRole('button', { name: '取消删除' }));
  await act(async () => { database.deleteAgent('a'); });
  fireEvent.click(screen.getByRole('button', { name: '删除 Provider' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 Provider' }));
  await waitFor(() => expect(database.listProviderSummaries()).toEqual([]));
});
