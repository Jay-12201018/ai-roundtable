import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomsFeature } from '../../../src/renderer/features/rooms/RoomsFeature';
import type { HistoryMessage, RoomConfiguration } from '../../../src/shared/contracts/configuration';
import { props, room, timestamp } from './fixtures';

afterEach(cleanup);

it('saves room edits, confirms archival/deletion, restores and selects the remaining room', async () => {
  const p = props(); let records: RoomConfiguration[] = [room(), room('r2', '另一个房间')];
  vi.mocked(p.api.listRooms).mockImplementation(async input => records.filter(item => input?.includeArchived || !item.archivedAt));
  vi.mocked(p.api.updateRoom).mockImplementation(async input => {
    const updated = { ...records.find(item => item.id === input.id)!, ...input, objective: input.objective ?? '' };
    records = records.map(item => item.id === input.id ? updated : item); return updated;
  });
  vi.mocked(p.api.archiveRoom).mockImplementation(async ({ id, archived = true }) => {
    const updated = { ...records.find(item => item.id === id)!, archivedAt: archived ? timestamp : null };
    records = records.map(item => item.id === id ? updated : item); return updated;
  });
  vi.mocked(p.api.deleteRoom).mockImplementation(async ({ id }) => { records = records.filter(item => item.id !== id); });
  render(<RoomsFeature {...p} />); await screen.findByRole('heading', { name: '项目讨论' });

  fireEvent.click(screen.getByRole('button', { name: '编辑房间' }));
  fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '已编辑房间' } });
  fireEvent.change(screen.getByLabelText('房间目标'), { target: { value: '已保存目标' } });
  fireEvent.click(screen.getByRole('button', { name: '保存房间' }));
  await screen.findByRole('heading', { name: '已编辑房间' });
  expect(p.api.updateRoom).toHaveBeenCalledWith({ id: 'r1', name: '已编辑房间', objective: '已保存目标' });
  expect(screen.getByText('已保存目标')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '项目讨论' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '归档房间' }));
  expect(p.api.archiveRoom).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('已有历史保留');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(p.api.archiveRoom).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '归档房间' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认归档' }));
  await screen.findByRole('heading', { name: '另一个房间' });
  expect(p.api.archiveRoom).toHaveBeenCalledWith({ id: 'r1' });
  expect(screen.queryByRole('button', { name: /已编辑房间/ })).toBeNull();
  expect(p.onSelectRoom).toHaveBeenLastCalledWith('r2');

  fireEvent.click(screen.getByLabelText('显示归档房间'));
  fireEvent.click(await screen.findByRole('button', { name: /已编辑房间/ }));
  await screen.findByRole('heading', { name: '已编辑房间' });
  expect(screen.getByText('已归档房间 · 可查看历史')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '恢复房间' }));
  await screen.findByText('已恢复房间');
  expect(p.api.archiveRoom).toHaveBeenLastCalledWith({ id: 'r1', archived: false });
  expect(screen.getByText('当前房间')).toBeTruthy();
  expect(p.onSelectRoom).toHaveBeenLastCalledWith('r1');

  fireEvent.click(screen.getByRole('button', { name: '删除房间' }));
  expect(screen.getByRole('dialog').textContent).toContain('删除不可撤销');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(p.api.deleteRoom).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '删除房间' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除' }));
  await screen.findByRole('heading', { name: '另一个房间' });
  expect(p.api.deleteRoom).toHaveBeenCalledWith({ id: 'r1' });
  expect(screen.queryByRole('button', { name: /已编辑房间/ })).toBeNull();
  expect(p.onSelectRoom).toHaveBeenLastCalledWith('r2');
  expect(records.map(item => item.id)).toEqual(['r2']);
});

function message(id = 'm1', content = '第一页消息', sortKey = 1): HistoryMessage {
  return { id, roomId: 'r1', runId: 'run', turnId: null, senderType: 'agent', senderName: '历史姓名', content,
    status: 'completed', sortKey, createdAt: timestamp, updatedAt: timestamp };
}

it('retries a failed first message page without claiming that history is empty', async () => {
  const p = props(); vi.mocked(p.api.listRoomMessages).mockRejectedValueOnce({ code: 'transport_error' })
    .mockResolvedValueOnce({ items: [message()], hasMore: false, nextCursor: null });
  render(<RoomsFeature {...p} />); await screen.findByRole('heading', { name: '项目讨论' });
  fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
  const messages = within(screen.getByRole('region', { name: '历史消息' }));
  expect((await messages.findByRole('alert')).textContent).toContain('连接失败');
  expect(messages.queryByText('暂无消息。')).toBeNull();
  fireEvent.click(messages.getByRole('button', { name: '重试消息' }));
  await messages.findByText('第一页消息');
  expect(p.api.listRoomMessages).toHaveBeenCalledTimes(2);
  expect(vi.mocked(p.api.listRoomMessages).mock.calls).toEqual([[{ roomId: 'r1', limit: 100 }], [{ roomId: 'r1', limit: 100 }]]);
  expect(messages.queryByRole('alert')).toBeNull();
});

it('retains messages and retries the exact same cursor after a next-page failure', async () => {
  const p = props(); const cursor = { roomId: 'r1', afterKey: 1, throughKey: 2 };
  vi.mocked(p.api.listRoomMessages).mockResolvedValueOnce({ items: [message()], hasMore: true, nextCursor: cursor })
    .mockRejectedValueOnce({ code: 'transport_error' })
    .mockResolvedValueOnce({ items: [message('m2', '第二页消息', 2)], hasMore: false, nextCursor: null });
  render(<RoomsFeature {...p} />); await screen.findByRole('heading', { name: '项目讨论' });
  fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
  const messages = within(screen.getByRole('region', { name: '历史消息' }));
  await messages.findByText('第一页消息');
  fireEvent.click(messages.getByRole('button', { name: '加载更多消息' }));
  await messages.findByRole('alert'); expect(messages.getByText('第一页消息')).toBeTruthy();
  fireEvent.click(messages.getByRole('button', { name: '重试消息' }));
  await messages.findByText('第二页消息');
  await waitFor(() => expect(messages.queryByRole('button', { name: '加载更多消息' })).toBeNull());
  expect(vi.mocked(p.api.listRoomMessages).mock.calls).toEqual([
    [{ roomId: 'r1', limit: 100 }], [{ roomId: 'r1', limit: 100, cursor }], [{ roomId: 'r1', limit: 100, cursor }],
  ]);
  expect(messages.getAllByText('第一页消息')).toHaveLength(1);
  expect(messages.getAllByText('第二页消息')).toHaveLength(1);
  expect(messages.queryByRole('alert')).toBeNull();
});
