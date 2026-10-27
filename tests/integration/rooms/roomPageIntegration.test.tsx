import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { RoomPage, createStarterRoom } from '../../../src/renderer/features/rooms';

const databases: Database[] = [];
afterEach(() => { cleanup(); databases.splice(0).forEach(db => db.close()); });

it('operates the room page against RoomService and SQLite: starter members, edit, order, archive and delete', async () => {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  const api = new RoomService(db);
  // No usable model: the three default members exist without one, never with Mock.
  const created = await createStarterRoom(api, { name: '集成房间', objective: '核对流程' }, undefined);
  expect(db.listAgentConfigurations(created.id).map(agent => [agent.displayName, agent.roleTemplateId, agent.providerId, agent.modelId])).toEqual([
    ['起草者', '起草', null, null], ['审查者', '审查', null, null], ['综合者', '综合', null, null]]);
  const onDeleted = vi.fn(); const onChanged = vi.fn();
  const view = (room = db.getRoomConfiguration(created.id)!) => <RoomPage api={api} room={room} providers={[]} readiness={[]} runs={[]} workflow={{ label: '自由讨论 · 3 回合', detail: '', onChange: () => {} }}
    onNewDiscussion={() => {}} onOpenRun={() => {}} onOpenSettings={() => {}} onChanged={onChanged} onDeleted={onDeleted} />;
  const { rerender } = render(view());
  await screen.findByText('起草者');
  expect(document.body.textContent!.match(/还没选模型，暂时不会参与讨论/gu)).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('房间名称'), { target: { value: '改名后的房间' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(db.getRoomConfiguration(created.id)?.name).toBe('改名后的房间'));
  rerender(view());
  fireEvent.keyDown(screen.getByRole('button', { name: /调整「综合者」的顺序/u }), { key: 'ArrowUp' });
  await waitFor(() => expect(db.listAgentConfigurations(created.id).map(agent => agent.displayName)).toEqual(['起草者', '综合者', '审查者']));
  const reviewer = screen.getByRole('switch', { name: '审查者 参与讨论' }).closest('li')!;
  fireEvent.click(within(reviewer).getByRole('button', { name: /「审查者」：编辑/u })); fireEvent.click(screen.getByRole('menuitem', { name: '归档' }));
  await screen.findByRole('button', { name: '已归档的成员（1）' });
  fireEvent.click(screen.getByRole('button', { name: '删除…' })); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(db.getRoomConfiguration(created.id)).toBeUndefined();
});
