import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomsFeature } from '../../../src/renderer/features/rooms/RoomsFeature';
import type { RoomMessagePage, RoomRunPage, AgentConfiguration } from '../../../src/shared/contracts/configuration';
import { agent, deferred, props, room, timestamp } from './fixtures';
afterEach(cleanup);
async function ready(p = props()) { render(<RoomsFeature {...p} />); await screen.findByRole('heading', { name: '项目讨论' }); return p; }

describe('R07 rooms independent feature', () => {
  it('selects rooms, creates persistent configuration and edits/cancels forms', async () => {
    const p = await ready(); expect(p.onSelectRoom).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByRole('button', { name: '新建房间' }));
    fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '新方案' } });
    fireEvent.change(screen.getByLabelText('房间目标'), { target: { value: '完整验证' } });
    fireEvent.click(screen.getByRole('button', { name: '保存房间' }));
    await waitFor(() => expect(p.api.createRoom).toHaveBeenCalledWith({ name: '新方案', objective: '完整验证' }));
    await screen.findByText('已保存房间');
    fireEvent.click(screen.getByRole('button', { name: '编辑房间' }));
    fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '不保存' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(p.api.updateRoom).not.toHaveBeenCalled();
  });
  it('requires an explicit delete confirmation and translates protected deletion errors', async () => {
    const p = props(); vi.mocked(p.api.deleteRoom).mockRejectedValue({ code: 'invalid_state' }); await ready(p);
    fireEvent.click(screen.getByRole('button', { name: '删除房间' })); expect(p.api.deleteRoom).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog'); expect(dialog.textContent).toContain('历史');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
    await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('历史引用');
  });
  it('creates a configured member and displays save feedback', async () => {
    const p = await ready(); await screen.findByText('构思员');
    fireEvent.click(screen.getByRole('button', { name: '新增成员' }));
    fireEvent.change(screen.getByLabelText('成员名称'), { target: { value: '核验员' } });
    fireEvent.change(screen.getByLabelText('成员角色'), { target: { value: 'Critic' } });
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: '检查事实' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'p' } });
    fireEvent.click(screen.getByRole('button', { name: '保存成员' }));
    await waitFor(() => expect(p.api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ displayName: '核验员', roleTemplateId: 'Critic', systemPrompt: '检查事实', providerId: 'p', modelId: 'mock', roomId: 'r1' })));
    await screen.findByText('已保存成员');
  });
  it('shows invalid/disabled/missing providers explicitly and never replaces selection with Mock', async () => {
    const p = props(); vi.mocked(p.api.listAgentConfigurations).mockResolvedValue([{ ...agent(), providerId: 'missing', modelId: 'old-model' }]);
    await ready(p); await screen.findByText('Provider 不存在');
    fireEvent.click(screen.getByRole('button', { name: '编辑 构思员' }));
    expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('missing');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('old-model');
    fireEvent.click(screen.getByRole('button', { name: '保存成员' }));
    expect(p.api.updateAgent).not.toHaveBeenCalled(); await screen.findByRole('alert');
  });
  it('accepts real custom model identifiers and warns about unverified generation/key state', async () => {
    const p = props(); p.providers = [{ ...p.providers[0], id: 'real', kind: 'openai', name: '真实配置', customModels: [], defaultModelId: null }]; await ready(p); await screen.findByText('构思员');
    fireEvent.click(screen.getByRole('button', { name: '新增成员' }));
    fireEvent.change(screen.getByLabelText('成员名称'), { target: { value: 'A' } }); fireEvent.change(screen.getByLabelText('成员角色'), { target: { value: 'review' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'real' } }); fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'custom-model' } });
    expect(screen.getAllByText(/密钥状态/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '保存成员' }));
    await waitFor(() => expect(p.api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'real', modelId: 'custom-model' })));
  });
  it('disables and reorders with the complete non-archived member set', async () => {
    const p = props(); vi.mocked(p.api.listAgentConfigurations).mockResolvedValue([agent(), { ...agent('a2', '审查员'), displayOrder: 1, enabled: false }]); await ready(p);
    fireEvent.click(await screen.findByRole('button', { name: '禁用 构思员' }));
    await waitFor(() => expect(p.api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', enabled: false })));
    await screen.findByText('已禁用成员'); fireEvent.click(screen.getByRole('button', { name: '上移 审查员' }));
    await waitFor(() => expect(p.api.reorderAgents).toHaveBeenCalledWith({ roomId: 'r1', agentIds: ['a2', 'a1'] }));
  });
  it('clears selection, drafts and late member results when switching rooms', async () => {
    const p = props(); const old = deferred<AgentConfiguration[]>();
    vi.mocked(p.api.listAgentConfigurations).mockImplementation(({ roomId }) => roomId === 'r1' ? old.promise : Promise.resolve([])); await ready(p);
    fireEvent.click(screen.getByRole('button', { name: '另一个房间' })); await screen.findByRole('heading', { name: '另一个房间' });
    await act(async () => old.resolve([agent('old', '迟到旧成员')])); expect(screen.queryByText('迟到旧成员')).toBeNull();
    expect(p.onSelectRoom).toHaveBeenLastCalledWith('r2'); expect(screen.getByText('还没有成员')).toBeTruthy();
  });
  it('isolates late messages and Runs from the previous room', async () => {
    const p = props(); const oldRuns = deferred<RoomRunPage>(); const oldMessages = deferred<RoomMessagePage>();
    vi.mocked(p.api.listRoomRuns).mockImplementation(({ roomId }) => roomId === 'r1' ? oldRuns.promise : Promise.resolve({ items: [], hasMore: false, nextCursor: null }));
    vi.mocked(p.api.listRoomMessages).mockImplementation(({ roomId }) => roomId === 'r1' ? oldMessages.promise : Promise.resolve({ items: [], hasMore: false, nextCursor: null }));
    await ready(p); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '另一个房间' })); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    await act(async () => { oldRuns.resolve({ items: [{ id: 'old', roomId: 'r1', task: '旧任务', status: 'completed', createdAt: timestamp, updatedAt: timestamp }], hasMore: false, nextCursor: null }); oldMessages.resolve({ items: [{ id: 'm', roomId: 'r1', runId: 'old', turnId: null, senderType: 'agent', senderName: '旧姓名', content: '旧房间正文', status: 'completed', sortKey: 1, createdAt: timestamp, updatedAt: timestamp }], hasMore: false, nextCursor: null }); });
    expect(screen.queryByText('旧任务')).toBeNull(); expect(screen.queryByText('旧房间正文')).toBeNull();
  });
  it('uses stable cursors, preserves historical sender and calls the frozen Run detail callback', async () => {
    const p = props(); const cursor = { roomId: 'r1', afterKey: 1, throughKey: 2 };
    const message = { id: 'm1', roomId: 'r1', runId: 'run', turnId: null, senderType: 'agent' as const, senderName: '冻结姓名', content: '<script>unsafe</script>', status: 'completed' as const, sortKey: 1, createdAt: timestamp, updatedAt: timestamp };
    vi.mocked(p.api.listRoomRuns).mockResolvedValue({ items: [{ id: 'run', roomId: 'r1', task: '持久任务', status: 'paused', createdAt: timestamp, updatedAt: timestamp }], hasMore: false, nextCursor: null });
    vi.mocked(p.api.listRoomMessages).mockResolvedValueOnce({ items: [message], hasMore: true, nextCursor: cursor }).mockResolvedValue({ items: [{ ...message, id: 'm2', content: '第二页', sortKey: 2 }], hasMore: false, nextCursor: null });
    await ready(p); fireEvent.click(screen.getByRole('button', { name: '历史记录' })); await screen.findByText('冻结姓名');
    fireEvent.click(screen.getByRole('button', { name: '持久任务' })); expect(p.onSelectRun).toHaveBeenCalledWith('run');
    fireEvent.click(screen.getByRole('button', { name: '加载更多消息' })); await screen.findByText('第二页');
    expect(p.api.listRoomMessages).toHaveBeenLastCalledWith({ roomId: 'r1', limit: 100, cursor });
    expect(document.querySelector('script')).toBeNull(); expect(screen.getByText('<script>unsafe</script>')).toBeTruthy();
  });
  it('shows empty, retryable failure, provider load error and zero enabled members', async () => {
    const p = props(); vi.mocked(p.api.listAgentConfigurations).mockResolvedValue([{ ...agent(), enabled: false }]); p.providerLoadState = 'error'; await ready(p);
    await screen.findByText('没有启用的成员，无法开始新 Run。'); fireEvent.click(screen.getByRole('button', { name: '重新加载 Provider' })); expect(p.onReloadProviders).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '模型设置' })); expect(p.onOpenSettings).toHaveBeenCalledOnce();
  });
  it('retries a failed room list without rendering raw exception text', async () => {
    const p = props(); vi.mocked(p.api.listRooms).mockRejectedValueOnce(new Error('/private/secret.db'));
    render(<RoomsFeature {...p} />); await screen.findByRole('alert'); expect(document.body.textContent).not.toContain('/private/secret');
    fireEvent.click(screen.getByRole('button', { name: '重试房间列表' })); await screen.findByRole('heading', { name: '项目讨论' });
  });
});
