import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RoomManagementApiContract, RunSummary } from '../../../src/shared/contracts/configuration';
import { Sidebar, useRoomDirectory } from '../../../src/renderer/features/shell/Sidebar';

afterEach(cleanup);
const room = { id: 'room', name: '房间', objective: '', archivedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
// 650 discussions, oldest first, as Main pages them (100 per page; the cursor is opaque to the Renderer).
const runs: RunSummary[] = Array.from({ length: 650 }, (_, index) => ({ id: `run-${index + 1}`, roomId: 'room', status: 'completed', task: `第 ${index + 1} 场`,
  createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(), updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString() }));
function fakeApi(failPage?: { page: number; times: number }) {
  let failures = failPage?.times ?? 0;
  const listRoomRuns = vi.fn(async ({ cursor, limit }: { roomId: string; cursor?: { after: { n: number } }; limit: number }) => {
    const start = cursor?.after.n ?? 0;
    if (failPage && start / limit === failPage.page && failures > 0) { failures--; throw new Error('page failed'); }
    const items = runs.slice(start, start + limit); const end = start + items.length;
    return { items, hasMore: end < runs.length, nextCursor: end < runs.length ? { after: { n: end } } : null };
  });
  const api = { listRooms: vi.fn(async () => [room]), listAgentConfigurations: vi.fn(async () => []), listRoomRuns } as unknown as RoomManagementApiContract;
  return { api, listRoomRuns };
}
function Harness({ api }: { api: RoomManagementApiContract }) {
  const directory = useRoomDirectory(api, 'room', 'k');
  return <Sidebar rooms={directory.rooms} archived={directory.archived} counts={directory.counts} runs={directory.runs} failed={directory.failed} runsFailed={directory.runsFailed}
    onRetry={() => void directory.reload()} roomId="room" page="discussion" ready onOpenRoom={() => {}} onSelectRun={() => {}} onNewDiscussion={() => {}} onNewRoom={() => {}} onOpenUsage={() => {}} onOpenSettings={() => {}} />;
}
const firstRun = () => within(screen.getByRole('list', { name: '房间 的讨论记录' })).getAllByRole('button')[0];

it('reads every page, so with more than 500 discussions the newest is at the top', async () => {
  const { api, listRoomRuns } = fakeApi(); render(<Harness api={api} />);
  await waitFor(() => expect(firstRun().textContent).toContain('第 650 场'));
  expect(listRoomRuns).toHaveBeenCalledTimes(7);
  expect(screen.getByRole('button', { name: '显示全部 650 场' })).toBeTruthy();
});

it('says when a page fails instead of showing a cut-short list, and reads it again on 重试', async () => {
  const { api } = fakeApi({ page: 5, times: 1 }); render(<Harness api={api} />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('讨论记录没有读完');
  expect(screen.queryByText('第 500 场')).toBeNull();
  expect(screen.queryByText('还没有讨论。写下目标就能开始第一场。')).toBeNull();
  fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
  await waitFor(() => expect(firstRun().textContent).toContain('第 650 场'));
  expect(screen.queryByRole('alert')).toBeNull();
});
