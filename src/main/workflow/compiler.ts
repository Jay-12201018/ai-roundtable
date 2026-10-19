import { z } from 'zod';
import { ContractError } from '../../shared/contracts/errors';
import { agentConfigurationsSchema } from '../../shared/schemas/configuration';
import { idSchema, workflowSnapshotSchema as safeJsonSchema } from '../../shared/schemas/common';
import type { AgentConfiguration } from '../../shared/contracts/configuration';
import type { MemberSnapshot } from '../../shared/schemas/persistence';
import { workflowConfigSchema, workflowSnapshotSchema } from './definition';
import type { WorkflowConfig, WorkflowSnapshot, WorkflowStep } from './definition';

function invalid(): never { throw new ContractError('invalid_input'); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  return result.success ? result.data : invalid();
}
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }

function plan(config: WorkflowConfig, members: MemberSnapshot[]): WorkflowStep[] {
  const { stages, templateId, endCondition } = config;
  if (!unique(stages.map(s => s.id)) || !unique(members.map(m => m.agentId))) invalid();
  const kinds = stages.map(s => s.kind).join(',');
  if (templateId === 'review-revision' && (kinds !== 'draft,review,revise,rereview,finalize'
    || stages.some(s => s.memberIds.length !== 1 || s.rounds !== 1))) invalid();
  if (templateId === 'deep-debate' && (kinds !== 'opening,rebuttal,closing'
    || stages.some(s => s.memberIds.length < 2 || s.kind !== 'rebuttal' && s.rounds !== 1))) invalid();
  if (templateId === 'free-chat' && stages.some(s => s.kind !== 'discussion')) invalid();
  if (templateId === 'two-model-dialogue' && (stages.some(s => s.kind !== 'dialogue' || s.memberIds.length !== 2)
    || new Set(stages.flatMap(s => s.memberIds)).size !== 2)) invalid();
  if (endCondition.type === 'after_stage' && !stages.some(s => s.id === endCondition.stageId)) invalid();

  let declaredTurns = 0;
  const steps: WorkflowStep[] = [];
  let ended = false;
  for (const stage of stages) {
    if (!unique(stage.memberIds) || stage.memberIds.some(id => !members.some(m => m.agentId === id))) invalid();
    declaredTurns += stage.rounds * stage.memberIds.length;
    // Bound the entire declaration, including stages after an early terminal stage.
    if (declaredTurns > 256) invalid();
    if (!ended) {
      for (let round = 1; round <= stage.rounds; round++) {
        for (const agentId of stage.memberIds) steps.push({ index: steps.length, stageId: stage.id, kind: stage.kind, agentId, round });
      }
      ended = endCondition.type === 'after_stage' && stage.id === endCondition.stageId;
    }
  }
  if (steps.length > config.limits.maxTurns) invalid();
  return steps;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Current room/member evidence must come from Main, never a Renderer roster. No I/O. */
export function compileWorkflow(input: unknown, roomId: string, currentMembers: readonly AgentConfiguration[]): WorkflowSnapshot {
  const config = parse(workflowConfigSchema, input);
  parse(idSchema, roomId);
  const agents = parse(agentConfigurationsSchema, currentMembers);
  if (!unique(agents.map(a => a.id))) invalid();
  const selected = [...new Set(config.stages.flatMap(stage => stage.memberIds))];
  if (selected.length > 32) invalid();
  const members = selected.map(id => {
    const agent = agents.find(a => a.id === id);
    if (!agent || agent.roomId !== roomId || !agent.enabled || agent.archivedAt !== null) return invalid();
    const { id: agentId, displayName, roleTemplateId, systemPrompt, providerId, modelId, displayOrder } = agent;
    return { agentId, displayName, roleTemplateId, systemPrompt, providerId, modelId, displayOrder };
  });
  const snapshot = { version: 1 as const, roomId, config, members, steps: plan(config, members) };
  parse(safeJsonSchema, snapshot);
  return freeze(snapshot);
}

/** Rebuild and compare, rather than trusting persisted steps or interpreting unknown versions. */
export function readWorkflowSnapshot(input: unknown): WorkflowSnapshot {
  const snapshot = parse(workflowSnapshotSchema, input);
  const selected = [...new Set(snapshot.config.stages.flatMap(stage => stage.memberIds))];
  if (selected.length !== snapshot.members.length || selected.some((id, index) => snapshot.members[index].agentId !== id)
    || JSON.stringify(plan(snapshot.config, snapshot.members)) !== JSON.stringify(snapshot.steps)) invalid();
  parse(safeJsonSchema, snapshot);
  return freeze(snapshot);
}
