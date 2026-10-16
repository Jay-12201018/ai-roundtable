import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomsFeature } from '../../../src/renderer/features/rooms/RoomsFeature';
import { props, room, timestamp } from './fixtures';

afterEach(cleanup);

it.each(['archive', 'delete'] as const)('clears the parent selection after the last room is removed by %s', async action => {
  const p = props(); const onClearRoom = vi.fn();
  vi.mocked(p.api.listRooms).mockResolvedValue([room()]);
  render(<RoomsFeature {...p} onClearRoom={onClearRoom} />);
  await screen.findByRole('heading', { name: '项目讨论' });
  fireEvent.click(screen.getByRole('button', { name: action === 'archive' ? '归档房间' : '删除房间' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: action === 'archive' ? '确认归档' : '确认删除' }));
  await screen.findByRole('heading', { name: '你的下一场圆桌' });
  expect(onClearRoom).toHaveBeenCalledOnce();
});

it('notifies the parent of an initially empty room list', async () => {
  const p = props(); const onClearRoom = vi.fn();
  vi.mocked(p.api.listRooms).mockResolvedValue([]);
  render(<RoomsFeature {...p} onClearRoom={onClearRoom} />);
  await screen.findByRole('heading', { name: '你的下一场圆桌' });
  expect(onClearRoom).toHaveBeenCalledOnce();
});

it('keeps an archived restored room visible and clears the parent when it is filtered out', async () => {
  const p = props(); const onClearRoom = vi.fn(); const archived = { ...room(), archivedAt: timestamp };
  vi.mocked(p.api.listRooms).mockImplementation(async input => input?.includeArchived ? [archived] : []);
  vi.mocked(p.api.getRoomConfiguration).mockResolvedValue(archived);
  render(<RoomsFeature {...p} initialRoomId="r1" onClearRoom={onClearRoom} />);
  await screen.findByRole('heading', { name: '项目讨论' });
  expect((screen.getByLabelText('显示归档房间') as HTMLInputElement).checked).toBe(true);
  expect(p.onSelectRoom).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('显示归档房间'));
  await waitFor(() => expect(onClearRoom).toHaveBeenCalledOnce());
  expect(screen.queryByRole('heading', { name: '项目讨论' })).toBeNull();
});
