import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflow } from '../../../src/main/workflow';
import { WorkflowFeature } from '../../../src/renderer/features/workflows';
import type { WorkflowDraft, WorkflowFeatureProps, WorkflowPreviewResult, WorkflowTemplate } from '../../../src/renderer/features/workflows';
import { members, roomId } from '../../unit/workflows/fixtures';

afterEach(cleanup);

// Test-only parent adapter: no IPC protocol is introduced before Shared approval.
function proposedConfig(draft: WorkflowDraft) {
  return {
    version: 1, templateId: draft.template,
    stages: draft.phases.map(phase => ({ id: phase.key,
      kind: draft.template === 'free-chat' ? 'discussion' : draft.template === 'two-model-dialogue' ? 'dialogue' : phase.key,
      memberIds: phase.participants, rounds: Number(phase.repeat) })),
    limits: { maxTurns: Number(draft.turnLimit), maxDurationMs: Number(draft.durationMs), outputTokenLimit: Number(draft.outputTokens) },
    endCondition: draft.finishAt ? { type: 'after_stage', stageId: draft.finishAt } : { type: 'plan_complete' },
  };
}
function actions() {
  const accepted: ReturnType<typeof compileWorkflow>[] = [];
  const props: WorkflowFeatureProps = {
    scopeKey: 'fixture-room', members: members.map(m => ({ id: m.id, name: m.displayName, enabled: m.enabled })),
    onPreview: vi.fn(async (draft: WorkflowDraft): Promise<WorkflowPreviewResult> => {
      try {
        const snapshot = compileWorkflow(proposedConfig(draft), roomId, members);
        return { ok: true, preview: { id: 'fixture-preview', totalTurns: snapshot.steps.length,
          stages: draft.phases.map(phase => ({ id: phase.key, label: phase.title,
            turns: snapshot.steps.filter(step => step.stageId === phase.key).length,
            memberNames: phase.participants.map(id => members.find(m => m.id === id)!.displayName) })),
          nextStep: snapshot.steps[0].stageId, ending: draft.finishAt || '完成计划后结束', limits: `最多 ${snapshot.config.limits.maxTurns} 回合`,
        } };
      } catch { return { ok: false, errors: ['工作流配置无效。'] }; }
    }),
    onApply: vi.fn(async ({ draft }) => { accepted.push(compileWorkflow(proposedConfig(draft), roomId, members)); }),
  };
  return { props, accepted };
}

describe('R11 feature with the actual compiler through a fixture parent', () => {
  it.each<[WorkflowTemplate, number]>([['free-chat', 3], ['two-model-dialogue', 2], ['review-revision', 5], ['deep-debate', 12]])(
    '%s previews and applies its real finite plan', async (template, turns) => {
      const { props, accepted } = actions(); render(<WorkflowFeature {...props} />);
      fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: template } });
      fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
      expect(await screen.findByText(`预计 ${turns} 回合`)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
      await waitFor(() => expect(accepted).toHaveLength(1));
      expect(accepted[0].config.templateId).toBe(template);
      expect(accepted[0].steps).toHaveLength(turns);
      expect(Object.isFrozen(accepted[0])).toBe(true);
    });

  it('shows the compiler rejection and prevents applying an under-bounded plan', async () => {
    const { props, accepted } = actions(); render(<WorkflowFeature {...props} />);
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: 'review-revision' } });
    fireEvent.change(screen.getByLabelText('最大回合数'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    expect(await screen.findByText('工作流配置无效。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    expect(accepted).toEqual([]);
    expect(props.onApply).not.toHaveBeenCalled();
  });
});
