import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomConfiguration, RunSummary, StandaloneDiscussion } from '../../../src/shared/contracts/configuration';
import { Sidebar } from '../../../src/renderer/features/shell/Sidebar';

afterEach(cleanup);
const time = '2026-11-11T02:00:00.000Z';
const project = (id: string, name: string, archived = false): RoomConfiguration => ({ id, name, objective: '', kind: 'project', brief: '', defaultMode: 'group-chat', archivedAt: archived ? time : null, createdAt: time, updatedAt: time });
const run = (id: string, roomId: string, task: string | null, status: RunSummary['status'] = 'completed'): RunSummary => ({ id, roomId, status, task, createdAt: time, updatedAt: time });
const talk = (id: string, task: string, members: string[], options: { status?: RunSummary['status']; archived?: boolean } = {}): StandaloneDiscussion => ({
  room: { ...project(`s-${id}`, '独立讨论', options.archived), kind: 'standalone' }, run: run(id, `s-${id}`, task, options.status), members });

function show(extra: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const on = { onOpenRoom: vi.fn(), onSelectRun: vi.fn(), onNewDiscussion: vi.fn(), onNewRoom: vi.fn(), onNewInRoom: vi.fn(), onArchiveDiscussion: vi.fn(), onOpenUsage: vi.fn(), onOpenSettings: vi.fn(), onRetry: vi.fn() };
  render(<Sidebar rooms={[project('p1', '跑腿项目'), project('p2', '周报')]} archived={[project('p3', '旧项目', true)]} counts={new Map([['p1', 3]])}
    runs={[run('r2', 'p1', '定价怎么定'), run('r1', 'p1', '试点范围')]} failed={false}
    recent={[talk('a', '周末去哪玩', ['林舟', '阿哲', '小雨']), talk('b', '起个名字', ['老陆', '老周', '小唐', '苏苏', '阿成'], { status: 'running' }), talk('c', '没有成员记录的旧讨论', [])]}
    archivedRecent={[talk('z', '归档的那场', ['林舟'], { archived: true })]}
    roomId="p1" runId="r2" page="discussion" ready {...on} {...extra} />);
  return on;
}

describe('the sidebar: 新讨论, 项目, 最近讨论 (D167)', () => {
  it('starts a discussion from the top without a project, and says so', () => {
    const on = show();
    const button = screen.getByRole('button', { name: '新讨论' });
    expect(button.getAttribute('title')).toContain('不用先建项目');
    fireEvent.click(button);
    expect(on.onNewDiscussion).toHaveBeenCalledTimes(1);
    // On the 新讨论 page itself the button reads as where the host is.
    cleanup(); show({ composing: true, roomId: 's-new', runId: undefined });
    expect(screen.getByRole('button', { name: '新讨论' }).getAttribute('aria-current')).toBe('page');
  });

  it('lists the projects; the open one shows its discussions and a way to start another in it', () => {
    const on = show();
    const projects = screen.getByRole('list', { name: '项目' });
    expect(within(projects).getByRole('button', { name: '跑腿项目' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(projects).getByRole('button', { name: '周报' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('sb-count-p1')!.textContent).toBe('3 人');
    const discussions = within(screen.getByRole('list', { name: '跑腿项目 的讨论' })).getAllByRole('button');
    expect(discussions.map(item => item.textContent)).toEqual(['定价怎么定（已完成）', '试点范围（已完成）']);
    expect(discussions[0]!.getAttribute('aria-current')).toBe('page');
    // The open project's row carries the way to start another discussion in it.
    fireEvent.click(within(projects).getByRole('button', { name: '在「跑腿项目」里开新讨论' })); expect(on.onNewInRoom).toHaveBeenCalledWith('p1');
    expect(within(projects).queryByRole('button', { name: '在「周报」里开新讨论' })).toBeNull();
    fireEvent.click(discussions[1]!); expect(on.onSelectRun).toHaveBeenCalledWith('r1');
    fireEvent.click(within(projects).getByRole('button', { name: '周报' })); expect(on.onOpenRoom).toHaveBeenCalledWith('p2');
    fireEvent.click(screen.getByRole('button', { name: '新建项目' })); expect(on.onNewRoom).toHaveBeenCalledTimes(1);
    // A closed project shows no discussions of its own.
    expect(screen.queryByRole('list', { name: '周报 的讨论' })).toBeNull();
  });

  it('lists the discussions that belong to no project, newest first as given, each with who took part', () => {
    const on = show();
    const recent = screen.getByRole('list', { name: '最近讨论' });
    const rows = within(recent).getAllByRole('listitem');
    expect(rows.map(row => row.querySelector('.t')!.textContent)).toEqual(['周末去哪玩', '起个名字', '没有成员记录的旧讨论']);
    // Faces: up to three, then how many more; the names are in the title and for a screen reader.
    expect([...rows[0]!.querySelectorAll('.sb-faces .avatar')].map(face => face.textContent)).toEqual(['林', '阿', '小']);
    expect([...rows[1]!.querySelectorAll('.sb-faces .avatar')].map(face => face.textContent)).toEqual(['老', '老', '小', '+2']);
    expect(rows[2]!.querySelector('.sb-faces.is-empty')).not.toBeNull();
    expect(within(rows[0]!).getAllByRole('button')[0]!.getAttribute('title')).toBe('周末去哪玩 · 林舟、阿哲、小雨 · 已完成');
    expect(rows[1]!.textContent).toContain('成员：老陆、老周、小唐、苏苏、阿成');
    expect(rows[1]!.querySelector('.run-dot.is-live')).not.toBeNull();
    fireEvent.click(within(rows[0]!).getAllByRole('button')[0]!); expect(on.onSelectRun).toHaveBeenCalledWith('a');
    // One action per row: archive. A discussion that is still going says why it cannot be archived yet.
    fireEvent.click(within(rows[0]!).getByRole('button', { name: '归档「周末去哪玩」' })); expect(on.onArchiveDiscussion).toHaveBeenCalledWith('s-a', true);
    expect((within(rows[1]!).getByRole('button', { name: '「起个名字」还在进行，先停止它再归档' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps archived projects and archived discussions together, out of the way, and gives each a way back', () => {
    const on = show();
    expect(screen.queryByText('归档的那场')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '已归档（2）' }));
    expect(within(screen.getByRole('list', { name: '已归档的项目' })).getByRole('button', { name: '旧项目' })).toBeTruthy();
    const row = within(screen.getByRole('list', { name: '已归档的讨论' })).getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: '恢复「归档的那场」' })); expect(on.onArchiveDiscussion).toHaveBeenCalledWith('s-z', false);
    fireEvent.click(within(row).getAllByRole('button')[0]!); expect(on.onSelectRun).toHaveBeenCalledWith('z');
  });

  it('says what each empty list is for, and when one could not be read', () => {
    show({ rooms: [], archived: [], recent: [], archivedRecent: [], runs: [], roomId: undefined });
    expect(screen.getByText('还没有项目。几场讨论要共用成员和背景时，点「+」建一个。')).toBeTruthy();
    expect(screen.getByText('不属于任何项目的讨论会列在这里。点上面的「新讨论」开始一场。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^已归档/u })).toBeNull();
    cleanup();
    const on = show({ recent: undefined, recentFailed: true });
    const alert = screen.getByText('最近讨论没有读出来。');
    fireEvent.click(within(alert).getByRole('button', { name: '重试' })); expect(on.onRetry).toHaveBeenCalledTimes(1);
  });

  it('folds a long list of recent discussions and opens it on request', () => {
    show({ recent: Array.from({ length: 15 }, (_, index) => talk(`n${index}`, `第 ${index + 1} 场`, ['林舟'])) });
    expect(within(screen.getByRole('list', { name: '最近讨论' })).getAllByRole('listitem')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: '显示全部 15 场' }));
    expect(within(screen.getByRole('list', { name: '最近讨论' })).getAllByRole('listitem')).toHaveLength(15);
  });
});
