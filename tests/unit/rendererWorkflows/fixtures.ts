import { vi } from 'vitest';
import type { WorkflowFeatureProps, WorkflowPreview, WorkflowProgress } from '../../../src/renderer/features/workflows';

export const members = [
  { id: 'a', name: '起草员', enabled: true },
  { id: 'b', name: '审查员', enabled: true },
  { id: 'c', name: '总结员', enabled: true },
  { id: 'disabled', name: '停用成员', enabled: false },
];

export const preview: WorkflowPreview = {
  id: 'authority-preview-1',
  totalTurns: 3,
  stages: [{ id: 'discussion', label: '讨论', turns: 3, memberNames: ['起草员', '审查员', '总结员'] }],
  nextStep: '讨论：起草员，第 1 回合',
  ending: '完成计划后结束',
  limits: '最多 12 回合；累计 300000 毫秒；单次输出上限 1024 Token',
};

export const progress: WorkflowProgress = {
  runLabel: '历史任务', status: '已暂停', completedTurns: 1, totalTurns: 3,
  elapsedMs: 1200, currentStage: '讨论', nextStep: '讨论：审查员，第 2 回合',
  stages: [{ id: 'discussion', label: '讨论', status: '进行中', completedTurns: 1, totalTurns: 3 }],
};

export function props(): WorkflowFeatureProps {
  return {
    scopeKey: 'room-1:revision-1', members,
    onPreview: vi.fn(async () => ({ ok: true as const, preview })),
    onApply: vi.fn(async () => {}),
    progress,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
