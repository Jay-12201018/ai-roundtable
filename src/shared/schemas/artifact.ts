import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { errorCodeSchema } from './error';

/**
 * R14 structured artifacts (D118–D123). A model writes one of four documents as JSON; Main parses it with the strict
 * schema below. Nothing a model writes is effective until the host adopts it (or writes it themselves).
 */
export const artifactKindValues = ['prd', 'minutes', 'actions', 'code'] as const;
export const artifactKindSchema = z.enum(artifactKindValues);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export const artifactKindLabels: Record<ArtifactKind, string> = { prd: '需求文档（PRD）', minutes: '会议纪要', actions: '行动清单', code: '代码候选' };
/**
 * D124: kinds a discussion may simply not contain (no code, no product, nothing to do). For these a model answers
 * `{"nothing": "<why>"}` instead of forcing a document. Minutes always exist: any discussion can be summarized.
 */
export const artifactNothingKinds: readonly ArtifactKind[] = ['prd', 'actions', 'code'];
export const MAX_NOTHING_REASON_CHARS = 500;
export const artifactNothingSchema = z.object({ nothing: z.string().trim().min(1).max(MAX_NOTHING_REASON_CHARS) }).strict();

/** Words a model uses for “not known”; they mean the same as an explicit null and are stored as null. */
const unknownWords = new Set(['未知', '不详', '不明', '待定', '待确认', '暂无', '无', '未指定', '未提及', '未明确', '未说明', 'tbd', 'unknown', 'n/a', 'na', 'none', 'null', '-', '—', '？', '?']);
const isUnknownWord = (value: unknown) => typeof value === 'string' && unknownWords.has(value.trim().toLowerCase());
/** A required key whose value is either known or explicitly null (未知). A missing key is an error, never “unknown”. */
const knownOrUnknown = <T extends z.ZodType>(schema: T) => z.preprocess(value => isUnknownWord(value) ? null : value, schema.nullable());
const text = (max: number) => z.string().trim().min(1).max(max);
/** Public message numbers as shown in the timeline; null when the discussion gives no traceable source. */
export const MAX_SOURCE_NUMBER = 100_000;
const sources = knownOrUnknown(z.array(z.number().int().min(1).max(MAX_SOURCE_NUMBER)).min(1).max(20)
  .refine(list => new Set(list).size === list.length, '来源编号不能重复'));
const uniqueBy = <T>(key: (item: T) => string, message: string) => (list: T[], ctx: z.RefinementCtx) => {
  const seen = new Map<string, number>();
  list.forEach((item, index) => {
    const value = key(item);
    if (seen.has(value)) ctx.addIssue({ code: 'custom', path: [index], message: `${message}（与第 ${seen.get(value)! + 1} 项重复）` });
    else seen.set(value, index);
  });
};

export const prdContentSchema = z.object({
  title: text(80),
  background: knownOrUnknown(text(2000)),
  goals: z.array(text(300)).min(1).max(10),
  requirements: z.array(z.object({
    id: z.string().regex(/^R\d{1,3}$/u, '编号应写成 R1、R2 这样'),
    title: text(120),
    description: text(1000),
    priority: z.enum(['must', 'should', 'could']),
    acceptanceCriteria: z.array(text(300)).min(1).max(10),
    sources,
  }).strict()).min(1).max(50).superRefine(uniqueBy(item => item.id, '需求编号重复')),
  nonGoals: z.array(text(300)).max(10),
  openQuestions: z.array(text(300)).max(20),
}).strict();

const point = z.object({ text: text(500), sources }).strict();
export const minutesContentSchema = z.object({
  title: text(80),
  summary: text(1000),
  participants: z.array(text(80)).max(64),
  conclusions: z.array(point).min(1).max(30),
  decisions: z.array(z.object({ text: text(500), rationale: knownOrUnknown(text(500)), decidedBy: knownOrUnknown(text(80)), sources }).strict()).max(30),
  openIssues: z.array(point).max(30),
}).strict();

export const actionStatusValues = ['todo', 'doing', 'done', 'blocked'] as const;
export const actionsContentSchema = z.object({
  title: text(80),
  items: z.array(z.object({
    id: z.string().regex(/^A\d{1,3}$/u, '编号应写成 A1、A2 这样'),
    task: text(300),
    owner: knownOrUnknown(text(80)),
    due: knownOrUnknown(text(40)),
    status: z.enum(actionStatusValues),
    sources,
  }).strict()).min(1).max(100).superRefine(uniqueBy(item => item.id, '事项编号重复')),
}).strict();

/**
 * A relative POSIX path inside the project a later write (R15) would target. It is only a candidate path: nothing here
 * touches the file system, and R15 must check it again against the folder the host chooses.
 */
export const candidatePathSchema = z.string().min(1).max(260)
  .refine(path => !/[\u0000-\u001f\u007f\\:*?"<>|]/u.test(path), '路径里不能有控制字符或 \\ : * ? " < > |')
  .refine(path => !path.startsWith('/') && !path.startsWith('~'), '只能写相对路径，不能以 / 或 ~ 开头')
  .refine(path => path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'), '路径不能含有空段、. 或 ..');
export const MAX_CODE_FILE_CHARS = 200_000;
export const MAX_CODE_TOTAL_CHARS = 400_000;
export const codeContentSchema = z.object({
  title: text(80),
  summary: text(1000),
  files: z.array(z.object({
    path: candidatePathSchema,
    language: knownOrUnknown(z.string().regex(/^[A-Za-z0-9+#.-]{1,32}$/u, '语言名只能是字母、数字和 + # . -，例如 typescript')),
    description: knownOrUnknown(text(300)),
    content: z.string().min(1).max(MAX_CODE_FILE_CHARS),
  }).strict()).min(1).max(20).superRefine(uniqueBy(file => file.path.toLowerCase(), '文件路径重复'))
    .refine(files => files.reduce((total, file) => total + file.content.length, 0) <= MAX_CODE_TOTAL_CHARS, `所有文件合计不能超过 ${MAX_CODE_TOTAL_CHARS} 个字符`),
  notes: z.array(text(300)).max(10),
}).strict();

export const artifactContentSchemas = { prd: prdContentSchema, minutes: minutesContentSchema, actions: actionsContentSchema, code: codeContentSchema } as const;
export type PrdContent = z.infer<typeof prdContentSchema>;
export type MinutesContent = z.infer<typeof minutesContentSchema>;
export type ActionsContent = z.infer<typeof actionsContentSchema>;
export type CodeContent = z.infer<typeof codeContentSchema>;
export type ArtifactContent = PrdContent | MinutesContent | ActionsContent | CodeContent;
export const artifactContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prd'), data: prdContentSchema }).strict(),
  z.object({ kind: z.literal('minutes'), data: minutesContentSchema }).strict(),
  z.object({ kind: z.literal('actions'), data: actionsContentSchema }).strict(),
  z.object({ kind: z.literal('code'), data: codeContentSchema }).strict(),
]);
export type TypedArtifactContent = z.infer<typeof artifactContentSchema>;

/** A field-located problem: `path` is machine-readable, `label` and `message` are for the host. */
export const artifactIssueSchema = z.object({
  path: z.string().max(400), label: z.string().max(400), message: z.string().min(1).max(400),
  line: z.number().int().min(1).optional(), column: z.number().int().min(1).optional(),
}).strict();
export type ArtifactIssue = z.infer<typeof artifactIssueSchema>;
export const MAX_ARTIFACT_ISSUES = 50;

/**
 * Version status: `generating` while the request streams; `failed` when it failed, was stopped or was interrupted
 * (partial output kept); `invalid` when the complete output did not parse or validate (output kept in full);
 * `candidate` when a model's output is valid but the host has not adopted it; `valid` once adopted or written by
 * the host; `exported` once a valid version was copied or saved (or, R15, at least one of its files was written); `empty` when the model said, in the agreed form, that
 * the discussion holds nothing of this kind (D124) — a valid answer, but not a document: never adopted or exported.
 */
export const artifactVersionStatusValues = ['generating', 'failed', 'invalid', 'candidate', 'valid', 'exported', 'empty'] as const;
export type ArtifactVersionStatus = (typeof artifactVersionStatusValues)[number];
export const artifactRequestStatusValues = ['generating', 'completed', 'failed', 'aborted', 'interrupted'] as const;
export const artifactOriginValues = ['generate', 'regenerate', 'edit'] as const;

const position = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
/** One message version an artifact version is based on, as the timeline shows it now. */
export const artifactSourceSchema = z.object({
  messageId: idSchema, slotId: idSchema, number: position.optional(), speaker: z.string().max(200),
  /** A confirmed summary stands for the messages it covers. */
  summary: z.object({ firstNumber: position, lastNumber: position }).strict().optional(),
  active: z.boolean(),
}).strict();
export const artifactVersionSchema = z.object({
  versionId: idSchema, artifactId: idSchema, number: position, origin: z.enum(artifactOriginValues), status: z.enum(artifactVersionStatusValues),
  parentVersionId: idSchema.optional(), agentId: idSchema.optional(),
  /** D125: a failed or stopped request names its public error code (never a response body or a Key). */
  request: z.object({ requestId: idSchema, status: z.enum(artifactRequestStatusValues), finishReason: z.enum(['stop', 'length']).optional(),
    errorCode: errorCodeSchema.optional() }).strict().optional(),
  /** The document title once valid; otherwise absent. */
  title: z.string().max(200).optional(),
  issues: z.array(artifactIssueSchema).max(MAX_ARTIFACT_ISSUES),
  /** D124: why there is nothing to write, in the model's words (status `empty`). */
  emptyReason: z.string().max(MAX_NOTHING_REASON_CHARS).optional(),
  outputChars: sequenceSchema,
  /** The public message numbers this version is based on (a summary counts for the numbers it covers). */
  firstNumber: position.optional(), lastNumber: position.optional(),
  /** D087/D109: messages it is based on that were later edited or regenerated, by timeline number. */
  affectedNumbers: z.array(position).max(4096),
  /** The latest copy, save or (R15) file write of this version. */
  adoptedAt: timestampSchema.optional(), exportedAt: timestampSchema.optional(),
  /** R15 (D130): each write of a code version into a folder the host chose, oldest first. */
  codeWrites: z.array(z.object({ exportId: idSchema, folder: z.string().min(1).max(4096), written: sequenceSchema, skipped: sequenceSchema, failed: sequenceSchema,
    at: timestampSchema }).strict()).max(256).optional(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict();
export const artifactSummarySchema = z.object({
  artifactId: idSchema, runId: idSchema, roomId: idSchema, kind: artifactKindSchema, createdAt: timestampSchema,
  versions: z.array(artifactVersionSchema).min(1).max(512),
}).strict();
export const artifactListInputSchema = z.object({ runId: idSchema }).strict();
export const artifactListSchema = z.object({ runId: idSchema, artifacts: z.array(artifactSummarySchema).max(256) }).strict();

export const artifactVersionInputSchema = z.object({ runId: idSchema, versionId: idSchema }).strict();
export const MAX_ARTIFACT_OUTPUT_CHARS = 1_000_000;
/** One version in full: the raw output exactly as received (or written) and, when valid, the parsed content. */
export const artifactVersionDetailSchema = z.object({
  runId: idSchema, artifactId: idSchema, kind: artifactKindSchema, version: artifactVersionSchema,
  rawOutput: z.string().max(MAX_ARTIFACT_OUTPUT_CHARS),
  content: artifactContentSchema.optional(),
  sources: z.array(artifactSourceSchema).max(4096),
}).strict();

export const artifactPreviewInputSchema = z.object({ runId: idSchema, kind: artifactKindSchema, agentId: idSchema.optional(), artifactId: idSchema.optional() }).strict();
export const artifactUnavailableReasonValues = ['busy', 'too_few', 'context_exceeds', 'budget_insufficient', 'unsupported'] as const;
export const artifactPreviewSchema = z.object({
  runId: idSchema, kind: artifactKindSchema, artifactId: idSchema.optional(),
  available: z.boolean(), reason: z.enum(artifactUnavailableReasonValues).optional(),
  agents: z.array(z.object({ agentId: idSchema, name: z.string().min(1), providerId: idSchema.nullable(), modelId: idSchema.nullable() }).strict()).max(64),
  agentId: idSchema.optional(),
  /** Public messages it would be based on; a confirmed summary stands in for 1..summarizedThrough. */
  messageCount: sequenceSchema, lastNumber: position.optional(), summarizedThrough: position.optional(),
  cost: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('free') }).strict(),
    z.object({ kind: z.literal('priced'), maxMicro: sequenceSchema, remainingMicro: sequenceSchema }).strict(),
    z.object({ kind: z.literal('unavailable') }).strict(),
  ]),
  outputTokenLimit: position, inputTokens: sequenceSchema.optional(), inputBudgetTokens: sequenceSchema.optional(),
}).strict();
export const artifactGenerateInputSchema = z.object({
  runId: idSchema, clientRequestId: idSchema, kind: artifactKindSchema, agentId: idSchema,
  /** Regenerate an existing artifact as a new version; its kind cannot change. */
  artifactId: idSchema.optional(),
}).strict();
export const artifactAdoptInputSchema = z.object({ runId: idSchema, clientRequestId: idSchema, versionId: idSchema }).strict();
/** The host's own version, written from `versionId`: JSON text checked with the same parser as model output. */
export const artifactEditInputSchema = z.object({ runId: idSchema, clientRequestId: idSchema, versionId: idSchema, text: z.string().min(1).max(MAX_ARTIFACT_OUTPUT_CHARS) }).strict();
export const artifactCommandResultSchema = z.object({
  runId: idSchema, artifactId: idSchema, versionId: idSchema, duplicate: z.boolean(), requestId: idSchema.optional(),
}).strict();
export const artifactExportFormatValues = ['markdown', 'json'] as const;
export const artifactExportInputSchema = z.object({
  runId: idSchema, clientRequestId: idSchema, versionId: idSchema, format: z.enum(artifactExportFormatValues), target: z.enum(['clipboard', 'file']),
}).strict();
export const artifactExportResultSchema = z.object({
  runId: idSchema, versionId: idSchema, format: z.enum(artifactExportFormatValues), target: z.enum(['clipboard', 'file']),
  /** Clipboard: the text to copy. File: whether the host saved one and its name (never the folder). */
  text: z.string().max(2 * MAX_ARTIFACT_OUTPUT_CHARS).optional(), saved: z.boolean(), fileName: z.string().max(260).optional(), duplicate: z.boolean(),
}).strict();

/**
 * D123: what R15 may consume. Only a code candidate the host adopted (or wrote) and that passed validation is
 * listed; nothing here has been written to disk or executed.
 */
export const validatedCodeCandidateSchema = z.object({
  runId: idSchema, roomId: idSchema, artifactId: idSchema, versionId: idSchema, versionNumber: position,
  status: z.enum(['valid', 'exported']), affected: z.boolean(), title: z.string().max(200), summary: z.string().max(1000),
  files: codeContentSchema.shape.files, notes: z.array(z.string()).max(10),
  sourceMessageIds: z.array(idSchema).max(4096), adoptedAt: timestampSchema,
}).strict();
export const codeCandidateListSchema = z.object({ runId: idSchema, candidates: z.array(validatedCodeCandidateSchema).max(256) }).strict();

export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;
export type ArtifactList = z.infer<typeof artifactListSchema>;
export type ArtifactListInput = z.infer<typeof artifactListInputSchema>;
export type ArtifactVersionInput = z.infer<typeof artifactVersionInputSchema>;
export type ArtifactVersionDetail = z.infer<typeof artifactVersionDetailSchema>;
export type ArtifactPreviewInput = z.infer<typeof artifactPreviewInputSchema>;
export type ArtifactPreview = z.infer<typeof artifactPreviewSchema>;
export type ArtifactGenerateInput = z.infer<typeof artifactGenerateInputSchema>;
export type ArtifactAdoptInput = z.infer<typeof artifactAdoptInputSchema>;
export type ArtifactEditInput = z.infer<typeof artifactEditInputSchema>;
export type ArtifactCommandResult = z.infer<typeof artifactCommandResultSchema>;
export type ArtifactExportInput = z.infer<typeof artifactExportInputSchema>;
export type ArtifactExportResult = z.infer<typeof artifactExportResultSchema>;
export type ValidatedCodeCandidate = z.infer<typeof validatedCodeCandidateSchema>;
export type CodeCandidateList = z.infer<typeof codeCandidateListSchema>;

export const priorityLabels: Record<PrdContent['requirements'][number]['priority'], string> = { must: '必须', should: '应该', could: '可以' };
export const actionStatusLabels: Record<(typeof actionStatusValues)[number], string> = { todo: '未开始', doing: '进行中', done: '已完成', blocked: '受阻' };
export const artifactStatusLabels: Record<ArtifactVersionStatus, string> = {
  generating: '生成中', failed: '没有完成', invalid: '校验失败', candidate: '候选 · 待采用', valid: '有效', exported: '有效 · 已导出', empty: '没有可整理的内容',
};
/** “第 1、3、4 条” for cited message numbers. */
export const sourceNumbersText = (numbers: readonly number[]) => `第 ${numbers.join('、')} 条`;

/** D124: where a host starts when writing a document of a kind the model found nothing for: every field, empty. */
export const artifactSkeletons: Record<ArtifactKind, unknown> = {
  prd: { title: '', background: null, goals: [''], requirements: [{ id: 'R1', title: '', description: '', priority: 'must', acceptanceCriteria: [''], sources: null }], nonGoals: [], openQuestions: [] },
  minutes: { title: '', summary: '', participants: [], conclusions: [{ text: '', sources: null }], decisions: [], openIssues: [] },
  actions: { title: '', items: [{ id: 'A1', task: '', owner: null, due: null, status: 'todo', sources: null }] },
  code: { title: '', summary: '', files: [{ path: '', language: null, description: null, content: '' }], notes: [] },
};
