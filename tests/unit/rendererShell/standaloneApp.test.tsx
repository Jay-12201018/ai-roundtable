import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/App';
import type { RoomConfiguration, StandaloneDiscussion } from '../../../src/shared/contracts/configuration';
import { agent, props as roomProps, room, timestamp } from '../rendererRooms/fixtures';
import { bridge } from '../rendererSubscriptions/fixtures';

const service = { id: 'ds', name: 'DeepSeek', kind: 'compatible' as const, enabled: true, isDefault: true, defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }], configurationValid: true, hasStoredKey: true };
const readiness = [{ providerId: 'ds', keyState: 'configured' as const, supported: true, baseUrl: 'https://api.deepseek.com', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null }] }];
const standaloneRoom = (id: string, mode: RoomConfiguration['defaultMode'] = 'group-chat'): RoomConfiguration => ({ ...room(id, '独立讨论'), objective: '', kind: 'standalone', defaultMode: mode });

function apis(options: { projects?: RoomConfiguration[]; recent?: StandaloneDiscussion[] } = {}) {
  const fake = bridge();
  const rooms = roomProps().api;
  let made = 0; const known = new Map<string, RoomConfiguration>((options.projects ?? [room('p1', '跑腿项目')]).map(item => [item.id, item]));
  for (const item of options.recent ?? []) known.set(item.room.id, item.room);
  vi.mocked(rooms.listRooms).mockImplementation(async () => [...known.values()].filter(item => item.kind === 'project'));
  vi.mocked(rooms.getRoomConfiguration).mockImplementation(async ({ id }) => known.get(id)!);
  vi.mocked(rooms.createStandalone).mockImplementation(async () => { const next = standaloneRoom(`s${++made}`); known.set(next.id, next); return next; });
  vi.mocked(rooms.listStandalone).mockImplementation(async () => options.recent ?? []);
  vi.mocked(rooms.listAgentConfigurations).mockImplementation(async ({ roomId }) => ['林舟', '阿哲', '小雨'].map((name, index) => ({ ...agent(`${roomId}-${index}`, name), roomId, providerId: 'ds', modelId: 'deepseek-flash', displayOrder: index })));
  vi.mocked(rooms.getLineup).mockResolvedValue({ ...room('roundtable-lineup', '常用阵容'), objective: '', kind: 'lineup' });
  window.roundtable = { ...fake.api, rooms, host: { command: vi.fn() }, summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn(), revoke: vi.fn() }, usage: { getReport: vi.fn(async () => { throw new Error('no usage'); }), exportCsv: vi.fn() },
    settings: { listProviderSummaries: vi.fn(async () => [service]), listModelReadiness: vi.fn(async () => readiness), getKeyStorageStatus: vi.fn(), refreshModels: vi.fn(async () => ({ providerId: 'ds', outcome: 'skipped' })) } } as unknown as typeof window.roundtable;
  return { ...fake, rooms };
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const status = () => screen.getByRole('status', { name: '运行状态' }).textContent;

describe('独立讨论 in the app (D167)', () => {
  it('opens on a new discussion with the lineup, on the default model, without asking for a project', async () => {
    const f = apis(); render(<App />);
    await screen.findByRole('heading', { name: '想和大家聊点什么？' });
    expect(f.rooms.createStandalone).toHaveBeenCalledTimes(1);
    expect(f.rooms.createStandalone).toHaveBeenCalledWith({ fallbackModel: { providerId: 'ds', modelId: 'deepseek-flash' } });
    expect(f.rooms.createRoom).not.toHaveBeenCalled();
    expect(status()).toContain('独立讨论'); expect(status()).toContain('3 位成员');
    expect(within(screen.getByRole('list', { name: '成员和模型' })).getAllByRole('listitem').map(item => item.querySelector('b')!.textContent)).toEqual(['林舟', '阿哲', '小雨']);
    // What is changed here stays in this discussion, and the page says where the lineup itself is changed.
    expect(document.body.textContent).toContain('成员来自常用阵容，这里的改动只用于这一场。');
    expect(screen.getByRole('button', { name: '新讨论' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '修改常用阵容' }));
    await screen.findByRole('heading', { level: 1, name: '常用阵容' });
    expect(f.rooms.getLineup).toHaveBeenCalled();
  });

  it('sends the first message as a group chat in that discussion\'s own room', async () => {
    const f = apis(); render(<App />);
    const box = await screen.findByRole('textbox', { name: '第一条消息' });
    fireEvent.change(box, { target: { value: '周末去哪玩' } });
    await waitFor(() => expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledTimes(1));
    expect(f.api.run.start).toHaveBeenCalledWith(expect.objectContaining({ roomId: 's1', task: '周末去哪玩', workflowSnapshot: { templateId: 'group-chat', version: 1 } }));
  });

  it('新讨论 in the sidebar starts another one from wherever the host is', async () => {
    const f = apis(); render(<App />);
    await screen.findByRole('heading', { name: '想和大家聊点什么？' });
    fireEvent.click(screen.getByRole('button', { name: '跑腿项目' }));
    await screen.findAllByRole('heading', { level: 1, name: '跑腿项目' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('.sidebar .sb-new')!);
    await screen.findByRole('heading', { name: '想和大家聊点什么？' });
    expect(f.rooms.createStandalone).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(status()).toContain('独立讨论'));
  });

  it('a project\'s new discussion is the project\'s: its name, its members, and no word about the lineup', async () => {
    const f = apis(); render(<App />);
    await screen.findByRole('heading', { name: '想和大家聊点什么？' });
    fireEvent.click(screen.getByRole('button', { name: '跑腿项目' }));
    fireEvent.click(await screen.findByRole('button', { name: '在「跑腿项目」里开新讨论' }));
    await waitFor(() => expect(status()).toContain('跑腿项目'));
    expect(document.body.textContent).toContain('这里改的是项目的成员和默认讨论方式');
    expect(document.body.textContent).not.toContain('成员来自常用阵容');
    expect(f.rooms.createStandalone).toHaveBeenCalledTimes(1);
  });

  it('says so and offers another try when a new discussion cannot be made, instead of trying forever', async () => {
    const f = apis(); vi.mocked(f.rooms.createStandalone).mockRejectedValueOnce(new Error('disk'));
    render(<App />);
    await screen.findByRole('heading', { name: '没能准备好新讨论' });
    expect(screen.getByRole('alert').textContent).toContain('已有的项目和讨论不受影响');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.rooms.createStandalone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '再试一次' }));
    await screen.findByRole('heading', { name: '想和大家聊点什么？' });
    expect(f.rooms.createStandalone).toHaveBeenCalledTimes(2);
  });

  it('lists started discussions under 最近讨论 and archives one from its row', async () => {
    const talk: StandaloneDiscussion = { room: standaloneRoom('old'), run: { id: 'run-old', roomId: 'old', status: 'completed', task: '起个名字', createdAt: timestamp, updatedAt: timestamp, groupChat: true }, members: ['林舟', '阿哲'] };
    const f = apis({ recent: [talk] }); render(<App />);
    const row = (await within(await screen.findByRole('list', { name: '最近讨论' })).findByText('起个名字')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: '归档「起个名字」' }));
    await waitFor(() => expect(f.rooms.archiveRoom).toHaveBeenCalledWith({ id: 'old', archived: true }));
    expect(f.rooms.deleteRoom).not.toHaveBeenCalled();
  });
});
