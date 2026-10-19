import type { AgentConfiguration } from '../../../src/shared/contracts/configuration';

export const roomId = 'workflow-room';
export const members: AgentConfiguration[] = ['a', 'b', 'c'].map((id, displayOrder) => ({
  id, roomId, displayName: `成员 ${id}`, roleTemplateId: 'assistant', systemPrompt: `Role ${id}`,
  providerId: null, modelId: null, enabled: true, displayOrder, archivedAt: null,
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
}));

export const limits = { maxTurns: 64, maxDurationMs: 300000, outputTokenLimit: 1024 };
export function config(templateId = 'review-revision') {
  const stage = (id: string, kind: string, memberIds: string[], rounds = 1) => ({ id, kind, memberIds, rounds });
  const stages = templateId === 'free-chat' ? [stage('discussion', 'discussion', ['c', 'a', 'b'], 2)]
    : templateId === 'two-model-dialogue' ? [stage('dialogue', 'dialogue', ['b', 'a'], 3)]
      : templateId === 'deep-debate' ? [stage('opening', 'opening', ['a', 'b', 'c']), stage('rebuttal', 'rebuttal', ['c', 'b', 'a'], 2), stage('closing', 'closing', ['a', 'b', 'c'])]
        : [stage('draft', 'draft', ['a']), stage('review', 'review', ['b']), stage('revise', 'revise', ['a']), stage('rereview', 'rereview', ['b']), stage('finalize', 'finalize', ['c'])];
  return { version: 1, templateId, stages, limits: { ...limits }, endCondition: { type: 'plan_complete' } };
}
