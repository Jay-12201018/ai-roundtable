import type { ArtifactKind } from '../../../src/shared/schemas/artifact';

/** One valid document per kind, citing messages 1–3; unknown facts are explicit nulls. */
export const validDocuments: Record<ArtifactKind, Record<string, unknown>> = {
  prd: {
    title: '校园跑腿平台', background: null, goals: ['30 分钟内送达'],
    requirements: [
      { id: 'R1', title: '下单', description: '学生可以发布跑腿订单。', priority: 'must', acceptanceCriteria: ['填写取件和送达地点后可以提交'], sources: [1] },
      { id: 'R2', title: '夜间配送', description: '22 点后仍可下单。', priority: 'could', acceptanceCriteria: ['22:30 下单成功'], sources: null },
    ],
    nonGoals: ['不做外卖平台'], openQuestions: ['配送费怎么定'],
  },
  minutes: {
    title: '跑腿平台讨论纪要', summary: '讨论了下单和配送。', participants: ['起草者', '审查者', '主持人'],
    conclusions: [{ text: '先做校内配送', sources: [2] }],
    decisions: [{ text: '首期只支持校内', rationale: null, decidedBy: '主持人', sources: [3] }],
    openIssues: [{ text: '配送费', sources: null }],
  },
  actions: {
    title: '跑腿平台行动清单',
    items: [
      { id: 'A1', task: '调研同类产品', owner: '起草者', due: '周五前', status: 'todo', sources: [1] },
      { id: 'A2', task: '确定配送费', owner: null, due: null, status: 'blocked', sources: [2, 3] },
    ],
  },
  code: {
    title: '订单校验', summary: '校验订单地点。',
    files: [{ path: 'src/order/validate.ts', language: 'typescript', description: null, content: 'export const ok = (a: string) => a.trim().length > 0;\n' }],
    notes: ['未处理并发'],
  },
};
export const text = (value: unknown) => JSON.stringify(value, null, 2);
export const clone = <T>(value: T): T => structuredClone(value);
