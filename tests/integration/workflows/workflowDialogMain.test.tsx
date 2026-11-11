import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { compileWorkflow } from '../../../src/main/workflow';
import { WorkflowDialog, workflowConfigFromDraft, workflowPlanSummary, type WorkflowCheck, type WorkflowDraft } from '../../../src/renderer/features/workflows';
import type { AgentConfiguration } from '../../../src/shared/contracts/configuration';

const time = '2026-10-16T00:00:00.000Z';
const agents: AgentConfiguration[] = [['a', '起草者', '起草'], ['b', '审查者', '审查'], ['c', '综合者', '综合']].map(([id, displayName, role], displayOrder) => ({
  id, roomId: 'room', displayName, roleTemplateId: role, systemPrompt: '', providerId: null, modelId: null, enabled: true, displayOrder, archivedAt: null, createdAt: time, updatedAt: time }));
const members = agents.map(agent => ({ id: agent.id, name: agent.displayName, enabled: true, role: agent.roleTemplateId }));
// The same refusal path as App: compile in Main's compiler, words for a refusal.
const check = async (draft: WorkflowDraft): Promise<WorkflowCheck> => {
  try { return { ok: true, summary: workflowPlanSummary(compileWorkflow(workflowConfigFromDraft(draft), 'room', agents)) }; }
  catch { return { ok: false, errors: ['按现在的成员和限制排不出这个流程。'] }; }
};
afterEach(cleanup);

it.each([['自由讨论', 3], ['双人对话', 4], ['审查修订链', 5], ['深度辩论', 12]] as const)('the actual compiler accepts the %s defaults (%i turns)', async (label, turns) => {
  render(<WorkflowDialog roomName="房间" members={members} onCheck={check} onSave={() => true} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`, 'u') }));
  await screen.findByText(new RegExp(`^已核对：预计 ${turns} 回合`, 'u'), undefined, { timeout: 2000 });
});

it('shows the compiler refusal of an under-bounded plan and keeps 用这个流程 unavailable', async () => {
  render(<WorkflowDialog roomName="房间" members={members} onCheck={check} onSave={() => true} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /^深度辩论/u }));
  fireEvent.change(screen.getByLabelText('最多回合'), { target: { value: '4' } });
  await screen.findByText('按现在的成员和限制排不出这个流程。', undefined, { timeout: 2000 });
  expect((screen.getByRole('button', { name: '用这个流程' }) as HTMLButtonElement).disabled).toBe(true);
  // Ending after the opening stage fits: three turns.
  fireEvent.click(within(screen.getByRole('list', { name: '阶段与成员' })).getAllByRole('button', { name: '在此结束' })[0]);
  await screen.findByText(/^已核对：预计 3 回合（立论后结束）/u, undefined, { timeout: 2000 });
});
