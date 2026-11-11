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
function fixture(runs: Array<{ id: string; task: string }> = [], options: { mode?: string } = {}) {
  // These tests are about the remembered flows. A room where free discussion was once chosen keeps it (D149): the profile's old note is handed to Main once.
  localStorage.setItem('roundtable.mode.room', 'free-chat');
  const fake = bridge();
  const previewWorkflow = vi.fn(async (input: { roomId: string; config: unknown }) => ({ previewId: `main-preview-${previewWorkflow.mock.calls.length}`, snapshot: compileWorkflow(input.config, input.roomId, agents) }));
  // D169: the mode is the room's own, kept by Main: this fake keeps it the way Main does. The app opens on a new discussion; here that is
  // the project itself, so these tests read the page a project's new discussion shows.
  const state = { id: 'room', name: '生产房间', objective: '', kind: 'project' as const, brief: '', defaultMode: options.mode ?? 'free-chat', archivedAt: null, createdAt: time, updatedAt: time };
  const rooms = {
    listRooms: vi.fn(async () => [{ ...state }]),
    getRoomConfiguration: vi.fn(async () => ({ ...state })),
    updateRoom: vi.fn(async (input: { defaultMode?: string }) => { state.defaultMode = input.defaultMode ?? state.defaultMode; return { ...state }; }),
    createStandalone: vi.fn(async () => ({ ...state })), listStandalone: vi.fn(async () => []),
    listAgentConfigurations: vi.fn(async (input: { roomId: string }) => agents.map(agent => ({ ...agent, roomId: input.roomId }))),
    listRoomRuns: vi.fn(async () => ({ items: runs.map(run => ({ ...run, roomId: 'room', status: 'completed', createdAt: time, updatedAt: time })), nextCursor: null, hasMore: false })),
  };
  window.roundtable = { ...fake.api, run: { ...fake.api.run, previewWorkflow }, rooms, settings: { listProviderSummaries: vi.fn(async () => []) }, usage: { getReport: vi.fn(async () => { throw new Error('no usage'); }) } } as unknown as typeof window.roundtable;
  return { ...fake, rooms, previewWorkflow };
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const chip = () => screen.getByRole('button', { name: '自定义流程' });
const mode = () => document.querySelector('.setup-seg [aria-pressed="true"]')?.textContent;
// Without a remembered mode the start button is usable before the members are read; the setup above the box, which these tests read, waits for them.
const ready = () => waitFor(() => {
  expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false);
  expect(chip()).toBeTruthy();
  expect(mode()).toBeTruthy();
});

describe('D116 the room remembers its discussion mode; Main checks it at every start', () => {
  it.each(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'] as const)('%s: checked in the dialog, remembered for the room, checked again at start', async template => {
    const f = fixture(); render(<App />); await ready();
    expect(mode()).toBe('自由讨论');
    fireEvent.click(chip());
    const dialog = await screen.findByRole('dialog', { name: '讨论方式' });
    const label = { 'free-chat': '自由讨论', 'two-model-dialogue': '双人对话', 'review-revision': '审查修订链', 'deep-debate': '深度辩论' }[template];
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${label}`, 'u') }));
    await within(dialog).findByText(/^已核对：预计 \d+ 回合/u, undefined, { timeout: 3000 });
    expect(f.api.run.start).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '用这个流程' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '讨论方式' })).toBeNull());
    expect(mode()).toBe(label);
    expect(JSON.parse(localStorage.getItem('roundtable.workflow.room')!)).toMatchObject({ version: 2, draft: { template } });
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
    expect(mode()).toBe('审查修订链');
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await screen.findByText(/讨论方式「审查修订链」需要调整：有一位成员已经不在成员里/u);
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

  it('waits for the room’s members before a remembered mode can start, instead of judging it against nobody', async () => {
    localStorage.setItem('roundtable.workflow.room', JSON.stringify({ version: 1, draft: createWorkflowDraft('review-revision', members) }));
    const f = fixture(); const gate = deferred<void>(); let held = true;
    const list = f.rooms.listAgentConfigurations.getMockImplementation()!;
    f.rooms.listAgentConfigurations.mockImplementation(async input => { if (held) await gate.promise; return list(input); });
    render(<App />);
    await screen.findByRole('button', { name: '开始讨论' });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(true);
    held = false; await act(async () => gate.resolve());
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledOnce());
    expect(document.body.textContent).not.toContain('需要调整');
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
    await screen.findByText(/这台电脑上保存的流程细节读不出来，这次按「自由讨论 · 3 回合」的默认流程进行/u);
    view.unmount(); localStorage.clear();
    // D169: nothing remembered in this profile at all (another computer, cleared storage): Main still knows the mode, and the
    // flow is its default plan for the members as they are now. Nothing was lost, so nothing is said.
    const f = fixture([{ id: 'last', task: '上一场' }], { mode: 'review-revision' });
    localStorage.clear();
    render(<App />); await ready();
    expect(mode()).toBe('审查修订链');
    expect(document.body.textContent).not.toContain('读不出来');
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledOnce());
    expect(vi.mocked(f.api.run.start).mock.calls[0][0]).toMatchObject({ roomId: 'room', workflowConfig: { templateId: 'review-revision' } });
  });

  it('closing the dialog without saving changes nothing; a late check after closing is ignored', async () => {
    const f = fixture(); const late = deferred<Awaited<ReturnType<typeof f.previewWorkflow>>>(); f.previewWorkflow.mockReturnValueOnce(late.promise);
    render(<App />); await ready();
    fireEvent.click(chip()); const dialog = await screen.findByRole('dialog', { name: '讨论方式' });
    await waitFor(() => expect(f.previewWorkflow).toHaveBeenCalledOnce(), { timeout: 2000 });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await act(async () => late.resolve({ previewId: 'late', snapshot: compileWorkflow(workflowConfigFromDraft(createWorkflowDraft('free-chat', members)), 'room', agents) }));
    expect(localStorage.getItem('roundtable.workflow.room')).toBeNull(); expect(f.api.run.start).not.toHaveBeenCalled();
    expect(mode()).toBe('自由讨论');
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

describe('D149 群聊 is how a room talks unless it chose otherwise', () => {
  const chosen = () => document.querySelector('.setup-seg [aria-pressed="true"]')?.textContent;
  const open = async () => { render(<App />); await waitFor(() => expect(chosen()).toBeTruthy()); };
  it('a room with nothing remembered opens on it; the first message starts one, with no plan', async () => {
    const f = fixture([], { mode: 'group-chat' }); localStorage.clear(); await open();
    expect(chosen()).toBe('群聊');
    expect(screen.queryByRole('button', { name: '自定义流程' })).toBeNull();
    expect(screen.queryByLabelText('每回合后暂停')).toBeNull();
    const box = screen.getByRole('textbox', { name: '第一条消息' });
    fireEvent.change(box, { target: { value: '集合开会！' } });
    await waitFor(() => expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledTimes(1));
    expect(f.api.run.start).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'room', task: '集合开会！', workflowSnapshot: { templateId: 'group-chat', version: 1 } }));
    expect(f.previewWorkflow).not.toHaveBeenCalled();
  });
  it('the four stricter ways are one click away under their own label, and go on working', async () => {
    const f = fixture([], { mode: 'group-chat' }); localStorage.clear(); await open();
    expect(document.querySelector('.setup-strict-label')?.textContent).toBe('更严格的流程');
    for (const name of ['自由讨论', '双人对话', '审查修订链', '深度辩论']) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '自由讨论' }));
    await waitFor(() => expect(chosen()).toBe('自由讨论'));
    fireEvent.change(screen.getByRole('textbox', { name: '讨论目标' }), { target: { value: '比较两个方案' } });
    await waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
    expect(f.rooms.updateRoom).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'room', defaultMode: 'free-chat' }));
    fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
    await waitFor(() => expect(f.api.run.start).toHaveBeenCalledTimes(1));
    expect(vi.mocked(f.api.run.start).mock.calls[0]![0].workflowSnapshot).toEqual({ templateId: 'draft-review-finalize', version: 1 });
  });
  it.each([['a flow', () => localStorage.setItem('roundtable.workflow.room', JSON.stringify({ version: 2, draft: createWorkflowDraft('deep-debate', members) })), '深度辩论'],
    ['free discussion', () => localStorage.setItem('roundtable.mode.room', 'free-chat'), '自由讨论'],
    ['a number of members, set before 群聊 existed', () => localStorage.setItem('roundtable.participants.room', '3'), '自由讨论']] as const)('a room that remembers %s keeps it', async (_name, remember, label) => {
    fixture([], { mode: 'group-chat' }); localStorage.clear(); remember(); await open();
    await waitFor(() => expect(chosen()).toBe(label));
  });
  it('going back to 群聊 is remembered', async () => {
    const f = fixture(); await open();
    await waitFor(() => expect(chosen()).toBe('自由讨论'));
    fireEvent.click(screen.getByRole('button', { name: '群聊' }));
    await waitFor(() => expect(chosen()).toBe('群聊'));
    expect(f.rooms.updateRoom).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'room', defaultMode: 'group-chat' }));
  });
});
