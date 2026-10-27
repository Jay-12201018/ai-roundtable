import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow } from '../../../src/main/workflow';
import { App } from '../../../src/renderer/App';
import { createWorkflowDraft, workflowConfigFromDraft } from '../../../src/renderer/features/workflows';
import type { AgentConfiguration } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';
import { bridge, deferred, snapshot, subscription, time } from '../rendererSubscriptions/fixtures';

const agents: AgentConfiguration[] = [['a', '起草者', '起草'], ['b', '审查者', '审查'], ['c', '综合者', '综合']].map(([id, displayName, role], displayOrder) => ({
  id, roomId: 'room', displayName, roleTemplateId: role, systemPrompt: '', providerId: 'mock', modelId: 'mock',
  enabled: true, displayOrder, archivedAt: null, createdAt: time, updatedAt: time,
}));
const members = agents.map(agent => ({ id: agent.id, name: agent.displayName, enabled: true, role: agent.roleTemplateId }));
function fixture(runs: Array<{ id: string; task: string }> = []) {
  const fake = bridge();
  const previewWorkflow = vi.fn(async (input: { roomId: string; config: unknown }) => ({ previewId: `main-preview-${previewWorkflow.mock.calls.length}`, snapshot: compileWorkflow(input.config, input.roomId, agents) }));
  const rooms = {
    listRooms: vi.fn(async () => [{ id: 'room', name: '生产房间', objective: '', archivedAt: null, createdAt: time, updatedAt: time }]),
    getRoomConfiguration: vi.fn(async () => ({ id: 'room', name: '生产房间', objective: '', archivedAt: null, createdAt: time, updatedAt: time })),
    listAgentConfigurations: vi.fn(async (input: { roomId: string }) => agents.map(agent => ({ ...agent, roomId: input.roomId }))),
    listRoomRuns: vi.fn(async () => ({ items: runs.map(run => ({ ...run, roomId: 'room', status: 'completed', createdAt: time, updatedAt: time })), nextCursor: null, hasMore: false })),
  };
  window.roundtable = { ...fake.api, run: { ...fake.api.run, previewWorkflow }, rooms, settings: { listProviderSummaries: vi.fn(async () => []) }, usage: { getReport: vi.fn(async () => { throw new Error('no usage'); }) } } as unknown as typeof window.roundtable;
  return { ...fake, rooms, previewWorkflow };
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const ready = () => waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
const chip = () => screen.getByRole('button', { name: /^讨论方式：/u });

describe('D116 the room remembers its discussion mode; Main checks it at every start', () => {
  it.each(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'] as const)('%s: checked in the dialog, remembered for the room, checked again at start', async template => {
    const f = fixture(); render(<App />); await ready();
    expect(chip().textContent).toContain('自由讨论 · 3 回合');
    fireEvent.click(chip());
    const dialog = await screen.findByRole('dialog', { name: '讨论方式' });
    const label = { 'free-chat': '自由讨论', 'two-model-dialogue': '双人对话', 'review-revision': '审查修订链', 'deep-debate': '深度辩论' }[template];
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${label}`, 'u') }));
    await within(dialog).findByText(/^已核对：预计 \d+ 回合/u, undefined, { timeout: 3000 });
    expect(f.api.run.start).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '用于这个房间' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '讨论方式' })).toBeNull());
    expect(chip().textContent).toContain(label);
    expect(JSON.parse(localStorage.getItem('roundtable.workflow.room')!)).toMatchObject({ version: 1, draft: { template } });
    const checks = f.previewWorkflow.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledOnce());
    // A fresh Main preview for the members as they are at the start, never a stale one from the dialog.
    expect(f.previewWorkflow.mock.calls.length).toBe(checks + 1);
    expect(vi.mocked(f.api.run.start).mock.calls[0][0]).toMatchObject({ roomId: 'room', workflowPreviewId: `main-preview-${checks + 1}`, workflowConfig: { templateId: template } });
    expect(vi.mocked(f.api.run.start).mock.calls[0][0]).not.toHaveProperty('workflowSnapshot');
  });

  it('says above the box why a remembered mode no longer fits, and starts nothing', async () => {
    const draft = createWorkflowDraft('review-revision', [...members, { id: 'gone', name: '离开的人', enabled: true, role: '审查' }].filter(member => member.id !== 'b'));
    draft.phases[1].participants = ['gone']; draft.phases[3].participants = ['gone'];
    localStorage.setItem('roundtable.workflow.room', JSON.stringify({ version: 1, draft }));
    const f = fixture(); render(<App />); await ready();
    expect(chip().textContent).toContain('审查修订链');
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await screen.findByText(/讨论方式「审查修订链」需要调整：有一位成员已经不在这个房间里/u);
    expect(f.previewWorkflow).not.toHaveBeenCalled(); expect(f.api.run.start).not.toHaveBeenCalled();
  });

  it('reports Main’s refusal at the start in words, and starts nothing', async () => {
    localStorage.setItem('roundtable.workflow.room', JSON.stringify({ version: 1, draft: createWorkflowDraft('deep-debate', members) }));
    const f = fixture(); f.previewWorkflow.mockRejectedValueOnce(publicError('unsupported'));
    render(<App />); await ready();
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await screen.findByText(/讨论方式「深度辩论」现在不能用：流程里有成员现在不能发言/u);
    expect(f.api.run.start).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '更改讨论方式' })).toBeTruthy();
  });

  it('without a remembered mode, starts with Main’s default plan', async () => {
    const f = fixture(); render(<App />); await ready();
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledOnce());
    expect(f.previewWorkflow).not.toHaveBeenCalled();
    expect(vi.mocked(f.api.run.start).mock.calls[0][0]).not.toHaveProperty('workflowConfig');
  });

  it('falls back to the default and says so when the saved mode is damaged or was lost', async () => {
    localStorage.setItem('roundtable.workflow.room', '{not json');
    fixture(); const view = render(<App />); await ready();
    await screen.findByText(/这个房间保存的讨论方式读不出来，这次按「自由讨论 · 3 回合」进行/u);
    view.unmount(); localStorage.clear();
    const f = fixture([{ id: 'last', task: '上一场' }]);
    const last = snapshot('last'); last.roomId = 'room'; last.status = 'completed';
    last.workflow = { templateId: 'review-revision', completedTurns: 5, totalTurns: 5, elapsedMs: 1, stages: [] as never };
    vi.mocked(f.api.run.getSnapshot).mockResolvedValue(last);
    render(<App />); await ready();
    await screen.findByText(/这台电脑上没有找到这个房间的讨论方式.*上次用的是「审查修订链」/u);
  });

  it('closing the dialog without saving changes nothing; a late check after closing is ignored', async () => {
    const f = fixture(); const late = deferred<Awaited<ReturnType<typeof f.previewWorkflow>>>(); f.previewWorkflow.mockReturnValueOnce(late.promise);
    render(<App />); await ready();
    fireEvent.click(chip()); const dialog = await screen.findByRole('dialog', { name: '讨论方式' });
    await waitFor(() => expect(f.previewWorkflow).toHaveBeenCalledOnce(), { timeout: 2000 });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await act(async () => late.resolve({ previewId: 'late', snapshot: compileWorkflow(workflowConfigFromDraft(createWorkflowDraft('free-chat', members)), 'room', agents) }));
    expect(localStorage.getItem('roundtable.workflow.room')).toBeNull(); expect(f.api.run.start).not.toHaveBeenCalled();
    expect(chip().textContent).toContain('自由讨论 · 3 回合');
  });
});

describe('a workflow Run reads its step and stage', () => {
  it('shows 第 n/N 步 · stage in the status line and the stage on each plan message', async () => {
    const f = fixture();
    const config = workflowConfigFromDraft(createWorkflowDraft('review-revision', members));
    const saved = snapshot('saved'); saved.roomId = 'room';
    saved.workflowSnapshot = compileWorkflow(config, 'room', agents) as unknown as typeof saved.workflowSnapshot;
    saved.turns[0].agentId = 'a'; saved.turns[0].turnIndex = 0; saved.turns[0].status = 'completed'; saved.currentTurnId = undefined; saved.activeAgentId = undefined;
    saved.messages[0] = { ...saved.messages[0], content: '初稿', status: 'completed' };
    saved.execution!.currentTurnId = null; saved.execution!.currentAgentId = null;
    saved.execution!.membersSnapshot = agents.map(({ id, displayName, roleTemplateId, systemPrompt, providerId, modelId, displayOrder }) => ({ agentId: id, displayName, roleTemplateId, systemPrompt, providerId, modelId, displayOrder }));
    saved.status = 'paused';
    saved.workflow = { templateId: 'review-revision', completedTurns: 1, totalTurns: 5, elapsedMs: 1234, currentStage: 'review',
      nextStep: { index: 1, stageId: 'review', kind: 'review', agentId: 'b', round: 1 },
      stages: [{ id: 'draft', kind: 'draft', status: 'completed', completedTurns: 1, totalTurns: 1 }, { id: 'review', kind: 'review', status: 'pending', completedTurns: 0, totalTurns: 1 }, { id: 'revise', kind: 'revise', status: 'pending', completedTurns: 0, totalTurns: 1 }, { id: 'rereview', kind: 'rereview', status: 'pending', completedTurns: 0, totalTurns: 1 }, { id: 'finalize', kind: 'finalize', status: 'pending', completedTurns: 0, totalTurns: 1 }] };
    vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved)); localStorage.setItem('roundtable.runId', 'saved');
    render(<App />); await screen.findByRole('heading', { name: '持久任务' });
    expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('第 1/5 步 · 审查');
    const message = await screen.findByRole('article', { name: /起草者/u });
    expect(within(message).getByText('起草')).toBeTruthy();
  });
});
