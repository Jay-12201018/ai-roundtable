import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { candidatePathSchema } from './artifact';

/**
 * R15 (D126–D131): writing an adopted code candidate into a folder the host chose. Main picks the folder in its own
 * dialog and hands the page only a reference; the page asks for a read-only preview of one version against that
 * folder, then for a write of the files the host ticked in that preview. Nothing is ever run.
 */

/** A folder Main let the host choose in this session; the page never sends a path of its own. */
export const codeExportRootSchema = z.object({
  rootId: idSchema,
  /** The folder's real path for display, with the home folder shown as ~. */
  displayPath: z.string().min(1).max(4096),
  name: z.string().min(1).max(255),
}).strict();
export type CodeExportRoot = z.infer<typeof codeExportRootSchema>;

export const codeExportChooseRootInputSchema = z.object({ runId: idSchema, versionId: idSchema }).strict();
/** Folders Main refuses to write into at all. */
export const codeExportRootRefusalValues = ['filesystem_root', 'app_data', 'git_dir', 'not_directory'] as const;
export const codeExportChooseRootResultSchema = z.object({
  runId: idSchema, versionId: idSchema,
  /** Absent when the host cancelled the dialog or the folder was refused. */
  root: codeExportRootSchema.optional(),
  refused: z.enum(codeExportRootRefusalValues).optional(),
}).strict().refine(result => !(result.root && result.refused), 'A refused folder has no reference');

/**
 * Why a file cannot be written as asked. Path problems are found from the candidate path alone; conflicts from what is
 * on disk; the rest only when writing.
 */
export const codeExportPathIssueValues = ['absolute', 'drive', 'unc', 'backslash', 'traversal', 'empty_segment', 'control_char', 'invisible_char', 'reserved_char',
  'reserved_name', 'trailing_dot_space', 'segment_too_long', 'git_dir', 'app_data', 'case_collision'] as const;
export const codeExportConflictValues = ['symlink_parent', 'parent_not_directory', 'target_symlink', 'target_directory', 'target_special', 'case_mismatch', 'outside_root'] as const;
export const codeExportWriteIssueValues = ['not_selected', 'unchanged', 'not_confirmed', 'not_writable', 'target_changed', 'candidate_changed', 'root_changed',
  'permission_denied', 'no_space', 'read_only', 'io_error'] as const;
export const codeExportReasonValues = [...codeExportPathIssueValues, ...codeExportConflictValues, ...codeExportWriteIssueValues] as const;
export const codeExportReasonSchema = z.enum(codeExportReasonValues);
export type CodeExportReason = z.infer<typeof codeExportReasonSchema>;

export const codeExportFileStatusValues = ['create', 'overwrite', 'same', 'conflict', 'invalid'] as const;
export type CodeExportFileStatus = (typeof codeExportFileStatusValues)[number];

/** Line diff of an existing file against the candidate, or why there is none. */
export const MAX_DIFF_LINES = 3000;
export const MAX_DIFF_LINE_CHARS = 2000;
const count = z.number().int().min(0).max(1_000_000);
export const codeExportDiffSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lines'), added: count, removed: count,
    hunks: z.array(z.object({
      oldStart: count, oldCount: count, newStart: count, newCount: count,
      lines: z.array(z.object({ op: z.enum(['same', 'add', 'remove']), text: z.string().max(MAX_DIFF_LINE_CHARS + 1) }).strict()).max(MAX_DIFF_LINES),
    }).strict()).max(MAX_DIFF_LINES),
    /** True when hunks were cut at MAX_DIFF_LINES. */
    truncated: z.boolean(),
  }).strict(),
  z.object({ kind: z.literal('unavailable'), reason: z.enum(['too_large', 'binary', 'too_many_changes']) }).strict(),
]);
export type CodeExportDiff = z.infer<typeof codeExportDiffSchema>;

export const codeExportPreviewFileSchema = z.object({
  path: candidatePathSchema, status: z.enum(codeExportFileStatusValues), reason: codeExportReasonSchema.optional(),
  /** Candidate content size in UTF-8 bytes and lines. */
  bytes: sequenceSchema, lines: sequenceSchema,
  /** Folders inside the chosen folder that writing this file would create, outermost first. */
  createsDirectories: z.array(z.string().min(1).max(260)).max(64),
  existing: z.object({ bytes: sequenceSchema, modifiedAt: timestampSchema }).strict().optional(),
  diff: codeExportDiffSchema.optional(),
}).strict().refine(file => (file.status === 'conflict' || file.status === 'invalid') === (file.reason !== undefined), 'Only a refused file has a reason')
  .refine(file => (file.status === 'overwrite') === (file.diff !== undefined), 'Only an overwrite has a diff');
export type CodeExportPreviewFile = z.infer<typeof codeExportPreviewFileSchema>;

export const codeExportPreviewInputSchema = z.object({ runId: idSchema, versionId: idSchema, rootId: idSchema }).strict();
export const codeExportPreviewSchema = z.object({
  previewId: idSchema, runId: idSchema, versionId: idSchema, versionNumber: z.number().int().min(1), root: codeExportRootSchema,
  /** False when the folder cannot be written by this app (checked again when writing). */
  writable: z.boolean(),
  files: z.array(codeExportPreviewFileSchema).min(1).max(20),
  createdAt: timestampSchema,
}).strict();
export type CodeExportPreview = z.infer<typeof codeExportPreviewSchema>;

/** The files the host ticked in one preview; an overwrite carries its own, separate confirmation. */
export const codeExportWriteInputSchema = z.object({
  runId: idSchema, clientRequestId: idSchema, previewId: idSchema,
  files: z.array(z.object({ path: candidatePathSchema, overwrite: z.boolean() }).strict()).min(1).max(20)
    .refine(files => new Set(files.map(file => file.path)).size === files.length, 'Each file once'),
}).strict();
export type CodeExportWriteInput = z.infer<typeof codeExportWriteInputSchema>;

export const codeExportOutcomeValues = ['written', 'skipped', 'failed'] as const;
export const codeExportFileResultSchema = z.object({
  path: candidatePathSchema, action: z.enum(['create', 'overwrite', 'none']), outcome: z.enum(codeExportOutcomeValues), reason: codeExportReasonSchema.optional(),
}).strict().refine(file => (file.outcome === 'written') === (file.reason === undefined), 'Only a written file has no reason');
export type CodeExportFileResult = z.infer<typeof codeExportFileResultSchema>;
export const codeExportWriteResultSchema = z.object({
  runId: idSchema, versionId: idSchema, previewId: idSchema, exportId: idSchema, duplicate: z.boolean(), root: z.object({ displayPath: z.string().min(1).max(4096), name: z.string().min(1).max(255) }).strict(),
  files: z.array(codeExportFileResultSchema).min(1).max(20),
  written: sequenceSchema, skipped: sequenceSchema, failed: sequenceSchema, createdAt: timestampSchema,
}).strict();
export type CodeExportWriteResult = z.infer<typeof codeExportWriteResultSchema>;

export type CodeExportChooseRootInput = z.infer<typeof codeExportChooseRootInputSchema>;
export type CodeExportChooseRootResult = z.infer<typeof codeExportChooseRootResultSchema>;
export type CodeExportPreviewInput = z.infer<typeof codeExportPreviewInputSchema>;

export const codeExportStatusLabels: Record<CodeExportFileStatus, string> = { create: '新建', overwrite: '覆盖', same: '内容相同', conflict: '不能写入', invalid: '路径无效' };
export const codeExportRootRefusalLabels: Record<(typeof codeExportRootRefusalValues)[number], string> = {
  filesystem_root: '不能直接写进磁盘的根目录，请选一个具体的文件夹。',
  app_data: '这是本应用自己的数据文件夹，不能写入。请另选一个文件夹。',
  git_dir: '这个文件夹在 .git 里面：那里的文件可能被 Git 自动执行，不能写入。请另选一个文件夹。',
  not_directory: '选中的不是文件夹。',
};
/** Why, in the host's words. */
export const codeExportReasonLabels: Record<CodeExportReason, string> = {
  absolute: '是绝对路径，只能写相对路径',
  drive: '带有盘符（如 C:），只能写相对路径',
  unc: '是网络路径（\\\\server\\share），只能写相对路径',
  backslash: '用了反斜杠 \\，路径只能用 / 分隔',
  traversal: '含有 .. 或 .（包括全角等写法），可能跳出所选文件夹',
  empty_segment: '含有空的一段（//）',
  control_char: '含有控制字符',
  invisible_char: '含有看不见的字符（零宽、软连字符或改变文字方向的字符等），显示的名字可能和实际不同',
  reserved_char: '含有文件名不允许的字符 : * ? " < > | 或全角的路径分隔符',
  reserved_name: '用了系统保留的名字（如 CON、NUL、COM1，包括全角写法）',
  trailing_dot_space: '某一段以点或空格结尾，在 Windows 上会被改名',
  segment_too_long: '某一段名字太长（超过 255 字节）',
  git_dir: '指向 .git 文件夹（包括 git~1、全角等写法）：那里的文件可能被 Git 自动执行，不能写入',
  app_data: '在本应用自己的数据文件夹里，不能写入',
  case_collision: '和这份候选里的另一个文件只差大小写，写入后会互相覆盖',
  symlink_parent: '路径上有一段是符号链接，可能指向所选文件夹以外',
  parent_not_directory: '路径上有一段已经是文件，不是文件夹',
  target_symlink: '目标是符号链接，不会通过链接写入',
  target_directory: '目标是一个文件夹',
  target_special: '目标不是普通文件',
  case_mismatch: '文件夹里已有只差大小写的同名文件或文件夹',
  outside_root: '实际位置在所选文件夹以外',
  not_selected: '没有勾选',
  unchanged: '内容相同，不需要写入',
  not_confirmed: '覆盖没有单独确认',
  not_writable: '这个文件不能写入（见检查结果）',
  target_changed: '目标在检查之后有变化，没有覆盖。请重新检查',
  candidate_changed: '候选内容在检查之后有变化。请重新检查',
  root_changed: '所选文件夹在检查之后被移动或替换。请重新选择',
  permission_denied: '没有写入权限',
  no_space: '磁盘空间不足',
  read_only: '磁盘是只读的',
  io_error: '写入时出错',
};
