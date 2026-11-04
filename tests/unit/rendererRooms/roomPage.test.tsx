import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomPage, MemberDialog, createStarterRoom, defaultModelFor } from '../../../src/renderer/features/rooms';
import type { AgentConfiguration, ProviderReadiness, ProviderSummary, RoomManagementApiContract, RunSummary } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';
import { agent, deferred, props as roomProps, room, timestamp } from './fixtures';

const deepseek: ProviderSummary = { id: 'ds', name: 'DeepSeek', kind: 'compatible', enabled: true, isDefault: true, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }], configurationValid: true, hasStoredKey: true };
const kimi: ProviderSummary = { id: 'oa', name: 'Kimi', kind: 'compatible', enabled: true, isDefault: false, defaultModelId: 'kimi-k3.1-pro', customModels: [], configurationValid: true, hasStoredKey: true };
const mock: ProviderSummary = { id: 'mk', name: '演示（Mock）', kind: 'mock', enabled: true, isDefault: false, defaultModelId: 'mock', customModels: [], configurationValid: true, hasStoredKey: false };
const readiness: ProviderReadiness[] = [
  { providerId: 'ds', keyState: 'configured', baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] },
  { providerId: 'oa', keyState: 'configured', baseUrl: 'https://service.example/v1', models: [{ modelId: 'kimi-k3.1-pro', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] },
  { providerId: 'mk', keyState: 'none', baseUrl: null, models: [{ modelId: 'mock', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] },
];
const member = (id: string, displayName: string, role: string, extra: Partial<AgentConfiguration> = {}): AgentConfiguration =>
  ({ ...agent(id, displayName), roleTemplateId: role, providerId: 'ds', modelId: 'deepseek-flash', ...extra });
function show(agents: AgentConfiguration[], extra: { runs?: RunSummary[]; api?: RoomManagementApiContract; providers?: ProviderSummary[] } = {}) {
  const api = extra.api ?? roomProps().api;
  vi.mocked(api.listAgentConfigurations).mockResolvedValue(agents);
  const callbacks = { onNewDiscussion: vi.fn(), onOpenRun: vi.fn(), onOpenSettings: vi.fn(), onChanged: vi.fn(), onDeleted: vi.fn(), change: vi.fn() };
  const view = render(<RoomPage api={api} room={room()} providers={extra.providers ?? [deepseek, kimi, mock]} readiness={readiness} runs={extra.runs ?? []}
    workflow={{ label: '自由讨论 · 3 回合', detail: '没有单独设置', onChange: callbacks.change }} {...callbacks} />);
  return { api, view, ...callbacks };
}
const row = (name: string) => screen.getByRole('switch', { name: `${name} 参与讨论` }).closest('li')!;
afterEach(cleanup);

describe('房间页: members', () => {
  it('says per member which model and whether it can take part now — never a silent Mock', async () => {
    show([member('a', '起草者', '起草'), member('b', '审查者', '审查', { providerId: 'oa', modelId: 'kimi-k3.1-pro' }), member('c', '综合者', '综合', { providerId: null, modelId: null }),
      member('d', '老周', '反方')]);
    await waitFor(() => expect(row('起草者').textContent).toContain('DeepSeek Flash · 可以使用'));
    expect(row('审查者').textContent).toContain('kimi-k3.1-pro · 还没填写 Key');
    expect(row('综合者').textContent).toContain('还没选模型，暂时不会参与讨论');
    expect(within(row('综合者')).getByRole('button', { name: '去选择' })).toBeTruthy();
    // The role tag is shown only when the name does not already say it.
    expect(within(row('起草者')).queryByText('起草')).toBeNull();
    expect(within(row('老周')).getByText('反方')).toBeTruthy();
  });

  it('reorders with the complete non-archived member set by keyboard, menu and drag', async () => {
    const { api } = show([member('a', '起草者', '起草'), member('b', '审查者', '审查'), member('c', '综合者', '综合'), member('z', '旧成员', '审查', { archivedAt: timestamp })]);
    await screen.findByText('起草者');
    fireEvent.keyDown(within(row('起草者')).getByRole('button', { name: /调整「起草者」的顺序/u }), { key: 'ArrowDown' });
    await waitFor(() => expect(api.reorderAgents).toHaveBeenLastCalledWith({ roomId: 'r1', agentIds: ['b', 'a', 'c'] }));
    await screen.findByText('已保存新的发言顺序。');
    fireEvent.click(within(row('综合者')).getByRole('button', { name: /「综合者」：编辑、排序/u }));
    fireEvent.click(screen.getByRole('menuitem', { name: '上移' }));
    await waitFor(() => expect(api.reorderAgents).toHaveBeenLastCalledWith({ roomId: 'r1', agentIds: ['a', 'c', 'b'] }));
    const transfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(row('综合者'), { dataTransfer: transfer }); fireEvent.dragOver(row('起草者'), { dataTransfer: transfer }); fireEvent.drop(row('起草者'), { dataTransfer: transfer });
    await waitFor(() => expect(api.reorderAgents).toHaveBeenLastCalledWith({ roomId: 'r1', agentIds: ['c', 'a', 'b'] }));
  });

  it('switches a member off for later discussions and keeps deletion behind a red second step with a translated refusal', async () => {
    const { api } = show([member('a', '起草者', '起草'), member('b', '审查者', '审查')]);
    await screen.findByText('起草者');
    fireEvent.click(screen.getByRole('switch', { name: '审查者 参与讨论' }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', enabled: false })));
    vi.mocked(api.deleteAgent).mockRejectedValueOnce(publicError('invalid_state'));
    fireEvent.click(within(row('审查者')).getByRole('button', { name: /「审查者」：编辑/u }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除…' }));
    expect(api.deleteAgent).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '删除' });
    expect(confirm.className).toContain('is-danger');
    fireEvent.click(confirm);
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveProperty('textContent', '现在不能这样做：可能有讨论正在进行，或已有讨论记录引用了它。有记录的可以归档。');
  });

  it('ignores a late member list from the previous room', async () => {
    const api = roomProps().api; const late = deferred<AgentConfiguration[]>();
    vi.mocked(api.listAgentConfigurations).mockReturnValueOnce(late.promise).mockResolvedValue([member('n', '新房间成员', '起草')]);
    const callbacks = { onNewDiscussion: vi.fn(), onOpenRun: vi.fn(), onOpenSettings: vi.fn(), onChanged: vi.fn(), onDeleted: vi.fn() };
    const workflow = { label: 'x', detail: 'y', onChange: vi.fn() };
    const view = render(<RoomPage api={api} room={room()} providers={[deepseek]} readiness={readiness} runs={[]} workflow={workflow} {...callbacks} />);
    view.rerender(<RoomPage api={api} room={room('r2', '另一个房间')} providers={[deepseek]} readiness={readiness} runs={[]} workflow={workflow} {...callbacks} />);
    await screen.findByText('新房间成员');
    await act(async () => late.resolve([member('old', '旧房间成员', '审查')]));
    expect(screen.queryByText('旧房间成员')).toBeNull();
  });
});

describe('房间页: archive and delete', () => {
  it('deletes only a room that never had a discussion, after a red confirmation', async () => {
    const { api, onDeleted } = show([member('a', '起草者', '起草')]);
    await screen.findByText('起草者');
    fireEvent.click(screen.getByRole('button', { name: '删除…' }));
    expect(api.deleteRoom).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('删除房间「项目讨论」？');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(api.deleteRoom).toHaveBeenCalledWith({ id: 'r1' })); expect(onDeleted).toHaveBeenCalled();
  });
  it('a room with discussions can only be archived', async () => {
    const { api } = show([member('a', '起草者', '起草')], { runs: [{ id: 'run', roomId: 'r1', status: 'completed', task: '旧讨论', createdAt: timestamp, updatedAt: timestamp }] });
    await screen.findByText('起草者');
    expect((screen.getByRole('button', { name: '删除…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('这个房间已经有讨论记录，不能删除；可以归档。');
    fireEvent.click(screen.getByRole('button', { name: '归档' }));
    await waitFor(() => expect(api.archiveRoom).toHaveBeenCalledWith({ id: 'r1', archived: true }));
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
  });
});

describe('添加成员 (D5-A)', () => {
  const dialog = (extra: Partial<Parameters<typeof MemberDialog>[0]> = {}) => {
    const onSave = vi.fn(async () => {}); const onOpenSettings = vi.fn();
    render(<MemberDialog roomId="r1" order={3} providers={[deepseek, kimi, mock]} readiness={readiness} onSave={onSave} onClose={() => {}} onOpenSettings={onOpenSettings} {...extra} />);
    return { onSave, onOpenSettings };
  };
  it('a role template fills name, role and 设定; the default service’s usable model is preselected', async () => {
    const { onSave } = dialog();
    fireEvent.click(screen.getByRole('button', { name: /^审查/u }));
    expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('审查者');
    expect((screen.getByLabelText('角色') as HTMLInputElement).value).toBe('审查');
    expect((screen.getByLabelText('设定可选') as HTMLTextAreaElement).value).toContain('你负责审查');
    expect(screen.getByRole('status').textContent).toBe('可以使用：Key 已保存。');
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '老周' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', displayName: '老周', roleTemplateId: '审查', providerId: 'ds', modelId: 'deepseek-flash', displayOrder: 3 })));
  });
  it('says why a model cannot take part, and with no usable default leaves the model empty instead of using Mock', async () => {
    const { onOpenSettings } = dialog({ providers: [{ ...deepseek, isDefault: false }, kimi, mock] });
    expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('status').textContent).toContain('还没选模型，暂时不会参与讨论');
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'oa\u0000kimi-k3.1-pro' } });
    expect(screen.getByRole('status').textContent).toContain('暂时不能参与讨论：还没填写 Key');
    fireEvent.click(screen.getByRole('button', { name: '去设置' })); expect(onOpenSettings).toHaveBeenCalled();
  });
  it('keeps the draft and shows a save failure inside the dialog', async () => {
    const onSave = vi.fn(async () => { throw publicError('invalid_input'); });
    dialog({ onSave });
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '保留的名字' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect((await screen.findByRole('alert')).textContent).toBe('有一项填写不对，请检查后再试。');
    expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('保留的名字');
  });
});

describe('新房间默认三位成员', () => {
  it('creates 起草者, 审查者 and 综合者 on the default service’s model only when it can be used', async () => {
    const api = roomProps().api;
    await createStarterRoom(api, { name: '新房间' }, defaultModelFor([deepseek], readiness));
    expect(vi.mocked(api.createAgent).mock.calls.map(([input]) => [input.displayName, input.roleTemplateId, input.modelId, input.displayOrder]))
      .toEqual([['起草者', '起草', 'deepseek-flash', 0], ['审查者', '审查', 'deepseek-flash', 1], ['综合者', '综合', 'deepseek-flash', 2]]);
    expect(defaultModelFor([{ ...kimi, isDefault: true }], readiness)).toBeUndefined();
    expect(defaultModelFor([deepseek], undefined)).toBeUndefined();
  });
});
