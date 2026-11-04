import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemberRoster, memberBlocked, type MemberRosterProps } from '../../../src/renderer/features/rooms';
import type { MemberRosterProps as Props } from '../../../src/renderer/features/rooms/MemberRoster';
import type { AgentConfiguration, ProviderReadiness, ProviderSummary } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';

afterEach(cleanup);
const at = '2026-11-04T00:00:00.000Z';
const service = (id: string, name: string, models: string[]): ProviderSummary => ({ id, name, kind: 'compatible', enabled: true, isDefault: false, defaultModelId: models[0]!, customModels: models.map(model => ({ id: model, name: model })), configurationValid: true, hasStoredKey: true } as ProviderSummary);
const ds = service('ds', 'DeepSeek', ['deepseek-flash', 'deepseek-v4-pro']);
const km = service('km', 'Kimi', ['kimi-k3']);
const ready = (providerId: string, baseUrl: string, models: string[], extra: Partial<ProviderReadiness> = {}): ProviderReadiness => ({ providerId, keyState: 'configured', supported: true, baseUrl,
  models: models.map(modelId => ({ modelId, contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null })), ...extra });
const readiness = [ready('ds', 'https://api.deepseek.com', ['deepseek-flash', 'deepseek-v4-pro']), ready('km', 'https://api.moonshot.cn/v1', ['kimi-k3'])];
const member = (id: string, displayName: string, extra: Partial<AgentConfiguration> = {}): AgentConfiguration => ({ id, roomId: 'r', displayName, roleTemplateId: '审查', systemPrompt: '设定', providerId: 'ds', modelId: 'deepseek-flash', enabled: true, displayOrder: 0, archivedAt: null, createdAt: at, updatedAt: at, ...extra } as AgentConfiguration);
function show(extra: Partial<Props> = {}) {
  const props = { api: { createAgent: vi.fn(async () => member('new', 'new')), updateAgent: vi.fn(async () => member('a', 'A')) }, roomId: 'r', members: [member('a', '审查者')], providers: [ds, km], readiness,
    onChanged: vi.fn(async () => {}), onOpenSettings: vi.fn(), onConnectMore: vi.fn(), ...extra } satisfies MemberRosterProps;
  render(<MemberRoster {...props} />);
  return props;
}

describe('新讨论 › 参与成员', () => {
  it('shows who takes part with the model list on the row, grouped by service, and says what a change applies to', () => {
    show();
    expect(document.body.textContent).toContain('每位成员可以用不同的模型。改动对这场和之后的讨论生效，已有讨论不变。');
    const list = screen.getByLabelText('审查者 的模型') as HTMLSelectElement;
    expect(list.value).toBe('ds\u0000deepseek-flash');
    expect([...list.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['DeepSeek', 'Kimi']);
    expect(screen.getByRole('switch', { name: '审查者 参与讨论' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑「审查者」' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加成员' })).toBeTruthy();
  });
  it('a model the service\'s list added shows just its ID, after the built-in ones with their notes', () => {
    show({ providers: [service('km', 'Kimi', ['kimi-k3', 'kimi-k9'])], readiness: [ready('km', 'https://api.moonshot.cn/v1', ['kimi-k3', 'kimi-k9'])], members: [member('a', '审查者', { providerId: 'km', modelId: 'kimi-k3' })] });
    const labels = [...(screen.getByLabelText('审查者 的模型') as HTMLSelectElement).options].map(option => option.textContent);
    expect(labels.at(-2)).toContain('多模态');
    expect(labels.at(-1)).toBe('kimi-k9');
  });
  it('saves a changed model with everything else as it was, and shows the choice while saving', async () => {
    let finish!: () => void;
    const onChanged = vi.fn(() => new Promise<void>(done => { finish = done; }));
    const props = show({ onChanged });
    const list = screen.getByLabelText('审查者 的模型') as HTMLSelectElement;
    fireEvent.change(list, { target: { value: 'km\u0000kimi-k3' } });
    await waitFor(() => expect(props.api.updateAgent).toHaveBeenCalledTimes(1));
    expect(props.api.updateAgent).toHaveBeenCalledWith({ id: 'a', roomId: 'r', displayName: '审查者', roleTemplateId: '审查', systemPrompt: '设定', providerId: 'km', modelId: 'kimi-k3', enabled: true, displayOrder: 0 });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(list.value).toBe('km\u0000kimi-k3');
    expect(list.disabled).toBe(true);
    finish();
    await waitFor(() => expect(list.disabled).toBe(false));
  });
  it('goes back to the old choice and says so when saving fails', async () => {
    const updateAgent = vi.fn(async () => { throw publicError('invalid_state'); });
    const props = show({ api: { createAgent: vi.fn(), updateAgent } as unknown as Props['api'] });
    const list = screen.getByLabelText('审查者 的模型') as HTMLSelectElement;
    fireEvent.change(list, { target: { value: 'km\u0000kimi-k3' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('没有保存，还是原来的选择。');
    expect(list.value).toBe('ds\u0000deepseek-flash');
    expect(props.onChanged).not.toHaveBeenCalled();
  });
  it('turns a member off and on through the same save', async () => {
    const props = show();
    fireEvent.click(screen.getByRole('switch', { name: '审查者 参与讨论' }));
    await waitFor(() => expect(props.api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', enabled: false, modelId: 'deepseek-flash' })));
  });
  it('can clear a choice: no model is picked for anybody', async () => {
    const props = show();
    fireEvent.change(screen.getByLabelText('审查者 的模型'), { target: { value: '' } });
    await waitFor(() => expect(props.api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ providerId: null, modelId: null })));
  });
  it.each([
    ['no model', member('a', '审查者', { providerId: null, modelId: null }), readiness, '还没选模型'],
    ['a Key that cannot be read', member('a', '审查者'), [ready('ds', 'https://api.deepseek.com', [], { keyState: 'missing', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] })], '还没填写 Key'],
    ['a model that left the catalog', member('a', '审查者', { modelId: 'gone-model' }), readiness, '这个模型已不再支持'],
  ] as const)('says why on the row when a member has %s, and the list stays there to change it', (_name, agent, rows, words) => {
    show({ members: [agent], readiness: [...rows] });
    const row = screen.getByLabelText('审查者 的模型').closest('li')!;
    expect(row.textContent).toContain(words);
    expect((within(row).getByLabelText('审查者 的模型') as HTMLSelectElement).disabled).toBe(false);
    expect(memberBlocked(agent, [ds, km], [...rows])).toBe(true);
  });
  it('a model the service no longer lists is flagged on the row but does not stop the discussion', () => {
    const rows = [ready('ds', 'https://api.deepseek.com', [], { models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null, delisted: true }] })];
    show({ readiness: rows });
    expect(screen.getByLabelText('审查者 的模型').closest('li')!.textContent).toContain('可能已下线');
    expect(memberBlocked(member('a', '审查者'), [ds], rows)).toBe(false);
  });
  it('offers more services only while there is one to choose from', () => {
    const one = show({ providers: [ds] });
    fireEvent.click(screen.getByRole('button', { name: '连接更多模型服务' }));
    expect(one.onConnectMore).toHaveBeenCalled();
    cleanup();
    show();
    expect(screen.queryByRole('button', { name: '连接更多模型服务' })).toBeNull();
  });
  it('opens the member dialog to add or edit, and reads the list again afterwards', async () => {
    const props = show();
    fireEvent.click(screen.getByRole('button', { name: '编辑「审查者」' }));
    expect(await screen.findByRole('heading', { name: '编辑「审查者」' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(props.api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', displayName: '审查者' })));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('is read-only in an archived room', () => {
    show({ readOnly: true });
    expect((screen.getByLabelText('审查者 的模型') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '添加成员' })).toBeNull();
  });
});
