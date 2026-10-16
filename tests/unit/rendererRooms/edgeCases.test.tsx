import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomsFeature } from '../../../src/renderer/features/rooms/RoomsFeature';
import { providerNotice } from '../../../src/renderer/features/rooms/MembersPanel';
import type { RoomConfiguration, RoomRunPage, AgentConfiguration } from '../../../src/shared/contracts/configuration';
import { agent, deferred, props, providers, room, timestamp } from './fixtures';
afterEach(cleanup);
async function ready(p = props()) { render(<RoomsFeature {...p} />); await screen.findByText('构思员'); return p; }

it.each([
  [{ ...providers[0], enabled: false }, 'Provider 已禁用'],
  [{ ...providers[0], configurationValid: false }, 'Provider 配置失效'],
  [{ ...providers[0], kind: null }, 'Provider 配置失效'],
] as const)('reports readiness from safe summaries: $1', (provider, expected) => {
  expect(providerNotice(agent(), [provider], 'ready')).toBe(expected);
});
it('warns on unconfigured members and isolates same model name by Provider instance', () => {
  expect(providerNotice({ providerId: null, modelId: null }, providers, 'ready')).toContain('尚未配置');
  expect(providerNotice({ providerId: 'different', modelId: 'mock' }, providers, 'ready')).toBe('Provider 不存在');
});
it('prevents late room creation from selecting over a newer room', async () => {
  const p = props(); const pending = deferred<RoomConfiguration>(); vi.mocked(p.api.createRoom).mockReturnValue(pending.promise); await ready(p);
  fireEvent.click(screen.getByRole('button', { name: '新建房间' })); fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '迟到新房' } });
  fireEvent.click(screen.getByRole('button', { name: '保存房间' })); fireEvent.click(screen.getByRole('button', { name: '另一个房间' }));
  await act(async () => pending.resolve(room('new', '迟到新房')));
  expect(p.onSelectRoom).toHaveBeenLastCalledWith('r2'); expect(screen.queryByRole('heading', { name: '迟到新房' })).toBeNull();
});
it('ignores a late failed member mutation after a room switch and does not unlock a new operation', async () => {
  const p = props(); const pending = deferred<AgentConfiguration>(); vi.mocked(p.api.updateAgent).mockReturnValue(pending.promise); await ready(p);
  fireEvent.click(screen.getByRole('button', { name: '禁用 构思员' })); fireEvent.click(screen.getByRole('button', { name: '另一个房间' }));
  await act(async () => pending.reject({ code: 'invalid_state' }));
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText('已禁用成员')).toBeNull();
});
it('archives with explanation, restores, and deletes only after confirmation', async () => {
  const p = props(); let archived = false;
  vi.mocked(p.api.listAgentConfigurations).mockImplementation(async () => [{ ...agent(), archivedAt: archived ? timestamp : null }]);
  vi.mocked(p.api.archiveAgent).mockImplementation(async ({ archived: next = true }) => { archived = next; return { ...agent(), archivedAt: next ? timestamp : null }; });
  await ready(p); fireEvent.click(screen.getByRole('button', { name: '归档 构思员' }));
  expect(screen.getByRole('dialog').textContent).toContain('原快照');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认归档' }));
  await screen.findByText('已归档成员');
  fireEvent.click(screen.getByRole('button', { name: '恢复 构思员' })); await screen.findByText('已恢复成员');
  fireEvent.click(screen.getByRole('button', { name: '删除 构思员' })); expect(p.api.deleteAgent).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(p.api.deleteAgent).toHaveBeenCalledWith({ id: 'a1' }));
});
it('validates empty forms and keeps dirty values on save failure', async () => {
  const p = props(); vi.mocked(p.api.createAgent).mockRejectedValue(new Error('PRIVATE_DETAIL')); await ready(p);
  fireEvent.click(screen.getByRole('button', { name: '新增成员' })); fireEvent.click(screen.getByRole('button', { name: '保存成员' }));
  await screen.findByRole('alert'); expect(p.api.createAgent).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('成员名称'), { target: { value: '重试名称' } }); fireEvent.change(screen.getByLabelText('成员角色'), { target: { value: '角色' } });
  fireEvent.click(screen.getByRole('button', { name: '保存成员' }));
  await waitFor(() => expect(p.api.createAgent).toHaveBeenCalledOnce());
  expect((screen.getByLabelText('成员名称') as HTMLInputElement).value).toBe('重试名称'); expect(document.body.textContent).not.toContain('PRIVATE_DETAIL');
});
it('paginates Runs, retries a failed next page with its same cursor and clears selected Run on refresh', async () => {
  const p = props(); const cursor = { roomId: 'r1', throughRowId: 3, after: { id: 'a', createdAt: timestamp }, through: { id: 'c', createdAt: timestamp } };
  const first = { id: 'a', roomId: 'r1', task: '首个任务', status: 'completed' as const, createdAt: timestamp, updatedAt: timestamp };
  vi.mocked(p.api.listRoomRuns).mockResolvedValueOnce({ items: [first], hasMore: true, nextCursor: cursor }).mockRejectedValueOnce({ code: 'transport_error' }).mockResolvedValueOnce({ items: [{ ...first, id: 'c', task: '后续任务' }], hasMore: false, nextCursor: null }).mockResolvedValue({ items: [first], hasMore: false, nextCursor: null });
  await ready(p); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '首个任务' }));
  fireEvent.click(screen.getByRole('button', { name: '加载更多 Run' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重试 Run 列表' })); await screen.findByText('后续任务');
  expect(p.api.listRoomRuns).toHaveBeenLastCalledWith({ roomId: 'r1', limit: 100, cursor });
  fireEvent.click(screen.getByRole('button', { name: '刷新历史' })); await waitFor(() => expect(screen.queryByText('所选 Run 的消息')).toBeNull());
  expect(p.api.listRoomRuns).toHaveBeenLastCalledWith({ roomId: 'r1', limit: 100 });
});
it('does not let late history pagination contaminate a newly selected room', async () => {
  const p = props(); const pending = deferred<RoomRunPage>();
  const cursor = { roomId: 'r1', throughRowId: 2, after: { id: 'a', createdAt: timestamp }, through: { id: 'b', createdAt: timestamp } };
  vi.mocked(p.api.listRoomRuns).mockResolvedValueOnce({ items: [{ id: 'a', roomId: 'r1', task: 'A', status: 'completed', createdAt: timestamp, updatedAt: timestamp }], hasMore: true, nextCursor: cursor }).mockReturnValueOnce(pending.promise).mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  await ready(p); fireEvent.click(screen.getByRole('button', { name: '历史记录' })); fireEvent.click(await screen.findByRole('button', { name: '加载更多 Run' }));
  fireEvent.click(screen.getByRole('button', { name: '另一个房间' })); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
  await act(async () => pending.resolve({ items: [{ id: 'b', roomId: 'r1', task: '迟到下一页', status: 'completed', createdAt: timestamp, updatedAt: timestamp }], hasMore: false, nextCursor: null }));
  expect(screen.queryByText('迟到下一页')).toBeNull();
});
