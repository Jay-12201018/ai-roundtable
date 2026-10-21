import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow } from '../../../src/main/workflow';
import { App } from '../../../src/renderer/App';
import type { AgentConfiguration } from '../../../src/shared/contracts/configuration';
import { bridge, deferred, snapshot, subscription, time } from '../rendererSubscriptions/fixtures';

const agents: AgentConfiguration[] = ['a', 'b', 'c'].map((id, displayOrder) => ({
  id, roomId: 'room', displayName: `成员 ${id}`, roleTemplateId: '角色', systemPrompt: '', providerId: 'mock', modelId: 'mock',
  enabled: true, displayOrder, archivedAt: null, createdAt: time, updatedAt: time,
}));
function fixture() {
  const fake = bridge();
  const previewWorkflow = vi.fn(async (input: {roomId: string; config: unknown}) => ({ previewId: 'main-preview', snapshot: compileWorkflow(input.config, input.roomId, agents) }));
  const rooms = {
    listRooms: vi.fn(async () => [{ id: 'room', name: '生产房间', objective: '', archivedAt: null, createdAt: time, updatedAt: time }]),
    getRoomConfiguration: vi.fn(async () => ({ id: 'room', name: '生产房间', objective: '', archivedAt: null, createdAt: time, updatedAt: time })),
    listAgentConfigurations: vi.fn(async (input: {roomId: string}) => agents.map(agent => ({ ...agent, roomId: input.roomId }))),
  };
  window.roundtable = { ...fake.api, run: { ...fake.api.run, previewWorkflow }, rooms, settings: { listProviderSummaries: vi.fn(async () => []) } } as unknown as typeof window.roundtable;
  return { ...fake, rooms, previewWorkflow };
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('production App workflow connection', () => {
  it('mounts the workflow editor for the selected room with current Main members', async () => {
    const f = fixture(); render(<App />);
    await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '工作流' }));
    await screen.findByRole('heading', { name: '工作流配置' });
    expect(f.rooms.listAgentConfigurations).toHaveBeenCalledWith({ roomId: 'room' });
    expect(screen.getAllByRole('option', { name: '成员 a' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: '成员 b' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('工作流验证尚未接入，当前只能编辑草稿。')).toBeNull();
  });
  it.each(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'] as const)('previews %s in Main, applies only the next config, then starts through the existing session', async template => {
    const f = fixture(); render(<App />);
    await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '工作流' }));
    await screen.findByRole('heading', { name: '工作流配置' });
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: template } });
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    await screen.findByRole('heading', { name: '已验证的计划预览' });
    expect(f.previewWorkflow).toHaveBeenCalledOnce(); expect(f.api.run.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    await screen.findAllByText(/下次开始将使用/);
    expect(f.api.run.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '讨论' }));
    fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledOnce());
    expect(vi.mocked(f.api.run.start).mock.calls[0][0]).toMatchObject({ roomId: 'room', workflowPreviewId: 'main-preview', workflowConfig: { templateId: template } });
    expect(vi.mocked(f.api.run.start).mock.calls[0][0]).not.toHaveProperty('workflowSnapshot');
  });
  it('rejects an applied workflow after members change until it is previewed and applied again', async () => {
    const f = fixture(); render(<App />);
    await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' })); await screen.findByRole('heading', { name: '已验证的计划预览' });
    fireEvent.click(screen.getByRole('button', { name: '应用配置' })); await screen.findAllByText(/下次开始将使用/);
    f.rooms.listAgentConfigurations.mockResolvedValue(agents.map(agent => ({ ...agent, updatedAt: '2026-10-20T00:00:00.000Z' })));
    fireEvent.click(screen.getByRole('button', { name: '讨论' }));
    await screen.findByText('房间成员已变化，请重新验证并应用工作流后再开始。');
    expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '开始协作' })); expect(f.api.run.start).not.toHaveBeenCalled();
  });
  it('shows only Main workflow progress and frozen member identity, without deriving progress from messages', async () => {
    const f = fixture(); const saved = snapshot('saved'); saved.roomId = 'room';
    saved.execution!.membersSnapshot = [{ agentId: 'b', displayName: '冻结的审查成员', roleTemplateId: '审查', systemPrompt: '', providerId: 'mock', modelId: 'mock', displayOrder: 1 }];
    saved.workflow = { templateId: 'review-revision', completedTurns: 2, totalTurns: 5, elapsedMs: 1234, currentStage: 'revise',
      nextStep: { index: 2, stageId: 'revise', kind: 'revise', agentId: 'b', round: 1 },
      stages: [{ id: 'draft', kind: 'draft', status: 'completed', completedTurns: 1, totalTurns: 1 }, { id: 'review', kind: 'review', status: 'completed', completedTurns: 1, totalTurns: 1 }, { id: 'revise', kind: 'revise', status: 'pending', completedTurns: 0, totalTurns: 1 }, { id: 'rereview', kind: 'rereview', status: 'pending', completedTurns: 0, totalTurns: 1 }, { id: 'finalize', kind: 'finalize', status: 'pending', completedTurns: 0, totalTurns: 1 }] };
    vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved)); localStorage.setItem('roundtable.runId', 'saved');
    render(<App />); await screen.findByRole('heading', { name: '持久任务' });
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    expect(screen.getByText('2 / 5 回合')).toBeTruthy(); expect(screen.getByText('累计用时 1234 毫秒')).toBeTruthy();
    expect(screen.getByText('下一步：修订 · 冻结的审查成员')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: 'deep-debate' } });
    expect(screen.getByText('2 / 5 回合')).toBeTruthy(); expect(screen.getByText('下一步：修订 · 冻结的审查成员')).toBeTruthy();
  });
  it('does not invent workflow progress for legacy snapshots', async () => {
    const f = fixture(); const saved = snapshot('saved'); saved.roomId = 'room';
    vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved)); localStorage.setItem('roundtable.runId', 'saved');
    render(<App />); await screen.findByRole('heading', { name: '持久任务' });
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    expect(screen.getByText('当前没有可显示的运行进度。')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('discards a late Main preview when the user selects another room', async () => {
    const f = fixture(); f.rooms.listRooms.mockResolvedValue([
      { id: 'room', name: '生产房间', objective: '', archivedAt: null, createdAt: time, updatedAt: time },
      { id: 'other', name: '另一房间', objective: '', archivedAt: null, createdAt: time, updatedAt: time },
    ]);
    const late = deferred<Awaited<ReturnType<typeof f.previewWorkflow>>>(); f.previewWorkflow.mockReturnValue(late.promise);
    render(<App />); await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    await waitFor(() => expect(f.previewWorkflow).toHaveBeenCalledOnce());
    const input = f.previewWorkflow.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '房间与成员' })); fireEvent.click(screen.getByRole('button', { name: '另一房间' }));
    await act(async () => late.resolve({ previewId: 'old-preview', snapshot: compileWorkflow(input.config, input.roomId, agents) }));
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    expect(screen.queryByRole('heading', { name: '已验证的计划预览' })).toBeNull();
    expect((screen.getByRole('button', { name: '应用配置' }) as HTMLButtonElement).disabled).toBe(true);
    expect(f.api.run.start).not.toHaveBeenCalled();
  });
  it('resets a newly edited workflow draft when selecting a historical Run and never starts it', async () => {
    const f = fixture(); const saved = snapshot('historic'); saved.roomId = 'room';
    const listRuns = vi.fn(async () => ({ items: [{ id: 'historic', roomId: 'room', task: '已保存历史', status: 'running', createdAt: time, updatedAt: time }], nextCursor: null, hasMore: false }));
    Object.assign(f.rooms, { listRoomRuns: listRuns });
    vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved));
    render(<App />); await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: 'deep-debate' } });
    fireEvent.click(screen.getByRole('button', { name: '房间与成员' })); fireEvent.click(screen.getByRole('button', { name: '历史记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '已保存历史' }));
    await screen.findByRole('heading', { name: '持久任务' });
    fireEvent.click(screen.getByRole('button', { name: '工作流' })); await screen.findByRole('heading', { name: '工作流配置' });
    expect((screen.getByLabelText('工作流模板') as HTMLSelectElement).value).toBe('free-chat');
    expect(f.api.run.start).not.toHaveBeenCalled(); expect(f.previewWorkflow).not.toHaveBeenCalled();
  });

});
