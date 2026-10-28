import type { ArtifactKind } from '../../../shared/schemas/artifact';

/**
 * R14: the toy model's artifact output (agentRole `artifact:<kind>`): a fixed, schema-valid document citing message 1,
 * with unknown owners and dates left null. It shows the flow only; it is never a real model's work.
 */
const documents: Record<ArtifactKind, unknown> = {
  prd: { title: 'Mock 需求文档', background: null, goals: ['演示需求文档的结构'],
    requirements: [{ id: 'R1', title: '整理讨论结论', description: 'Mock：把讨论中的方案整理成可以验收的需求。', priority: 'must', acceptanceCriteria: ['每条需求都有验收标准'], sources: [1] }],
    nonGoals: [], openQuestions: ['验证标准的具体数值'] },
  minutes: { title: 'Mock 会议纪要', summary: 'Mock：起草、审查和综合依次发言。', participants: [],
    conclusions: [{ text: 'Mock：形成了初步方案。', sources: [1] }], decisions: [], openIssues: [{ text: '验证标准的具体数值', sources: null }] },
  actions: { title: 'Mock 行动清单', items: [{ id: 'A1', task: 'Mock：补充验证标准', owner: null, due: null, status: 'todo', sources: [1] }] },
  code: { title: 'Mock 代码候选', summary: 'Mock：一个演示用的函数。',
    files: [{ path: 'src/mock/hello.ts', language: 'typescript', description: null, content: "export function hello(name: string): string {\n  return `你好，${name}`;\n}\n" }], notes: [] },
};

export function mockArtifactText(role: string): string | undefined {
  const kind = /^artifact:(prd|minutes|actions|code)$/u.exec(role)?.[1] as ArtifactKind | undefined;
  return kind ? JSON.stringify(documents[kind], null, 2) : undefined;
}
