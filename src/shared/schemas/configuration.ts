import { z } from 'zod';
import { idSchema, sequenceSchema, timestampSchema } from './common';
import { connectionLevelSchema, connectionTestResultSchema, providerModelSchema } from './provider';
import { messageStatusValues, runStatusValues } from '../types/run';

export const providerKindSchema = z.enum(['mock', 'openai', 'openai-compatible', 'anthropic', 'gemini']);
export const keyReferenceSchema = z.object({ id: idSchema }).strict();
export const keyStorageStatusSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('secure'), backend: z.string().min(1), persistent: z.literal(true), message: z.literal('密钥将使用系统安全存储持久化。') }).strict(),
  z.object({ mode: z.literal('memory'), backend: z.string().min(1), persistent: z.literal(false), message: z.literal('当前系统没有可靠的安全存储，密钥仅在本次会话有效。') }).strict(),
]);

export const providerBaseUrlSchema = z.string().trim().transform((value, ctx) => {
  let url: URL;
  try { url = new URL(value); } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid provider endpoint' });
    return z.NEVER;
  }
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu.exec(value)?.[1];
  // Check the original authority before URL normalizes numeric and IPv6 aliases.
  if (authority === undefined || /[?#\\\u0000-\u0020\u007f]/u.test(value) || authority.includes('@')
    || url.username !== '' || url.password !== ''
    || url.protocol !== 'https:' && (url.protocol !== 'http:' || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(authority))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid provider endpoint' });
    return z.NEVER;
  }
  return url.toString();
});

const providerInputObject = z.object({
  id: idSchema, name: z.string().trim().min(1), kind: providerKindSchema,
  baseUrl: providerBaseUrlSchema.nullable().default(null), enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false), defaultModelId: idSchema.nullable().default(null),
  customModels: z.array(providerModelSchema).default([]),
}).strict();
const enabledDefault = (input: { enabled: boolean; isDefault: boolean }) => !input.isDefault || input.enabled;
const uniqueModels = (input: { customModels: Array<{id:string}> }) => new Set(input.customModels.map(m => m.id)).size === input.customModels.length;
const mockHasNoEndpoint = (input: { kind: string; baseUrl: string | null }) => input.kind !== 'mock' || input.baseUrl === null;
export const providerInputSchema = providerInputObject.refine(mockHasNoEndpoint, 'Mock provider cannot have an endpoint').refine(enabledDefault, 'Default provider must be enabled').refine(uniqueModels, 'Model identities must be unique');
export const createProviderInputSchema = providerInputObject.omit({ id: true }).refine(mockHasNoEndpoint, 'Mock provider cannot have an endpoint').refine(enabledDefault, 'Default provider must be enabled').refine(uniqueModels, 'Model identities must be unique');
export const providerConfigurationSchema = providerInputObject.extend({
  keyReference: keyReferenceSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
}).refine(mockHasNoEndpoint, 'Mock provider cannot have an endpoint').refine(enabledDefault, 'Default provider must be enabled').refine(uniqueModels, 'Model identities must be unique');
export const providerSummarySchema = z.object({
  id: idSchema, name: z.string().trim().min(1), kind: providerKindSchema.nullable(), enabled: z.boolean(),
  isDefault: z.boolean(), defaultModelId: idSchema.nullable(), customModels: z.array(providerModelSchema),
  configurationValid: z.boolean(), hasStoredKey: z.boolean(),
}).strict();

export const roomInputSchema = z.object({ id: idSchema, name: z.string().trim().min(1), objective: z.string().default('') }).strict();
export const createRoomInputSchema = roomInputSchema.omit({ id: true });
export const roomConfigurationSchema = roomInputSchema.extend({
  archivedAt: timestampSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
});
const agentInputObject = z.object({
  id: idSchema, roomId: idSchema, displayName: z.string().trim().min(1), roleTemplateId: z.string().trim().min(1),
  systemPrompt: z.string().default(''), providerId: idSchema.nullable().default(null), modelId: idSchema.nullable().default(null),
  enabled: z.boolean().default(true), displayOrder: sequenceSchema.default(0),
}).strict();
const pairedModelSelection = (input: { providerId: string | null; modelId: string | null }) => (input.providerId === null) === (input.modelId === null);
export const agentInputSchema = agentInputObject.refine(pairedModelSelection, 'Provider and model must be configured together');
export const createAgentInputSchema = agentInputObject.omit({ id: true }).refine(pairedModelSelection, 'Provider and model must be configured together');
export const agentConfigurationSchema = agentInputObject.extend({
  archivedAt: timestampSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
});

export const configurationIdInputSchema = z.object({ id: idSchema }).strict();
export const listRoomsInputSchema = z.object({ includeArchived: z.boolean().default(false) }).strict();
export const listAgentConfigurationsInputSchema = listRoomsInputSchema.extend({ roomId: idSchema });
export const archiveConfigurationInputSchema = configurationIdInputSchema.extend({ archived: z.boolean().default(true) });
export const reorderAgentsInputSchema = z.object({ roomId: idSchema, agentIds: z.array(idSchema) }).strict()
  .refine((input) => new Set(input.agentIds).size === input.agentIds.length, 'Agent identities must be unique');
export const roomConfigurationsSchema = z.array(roomConfigurationSchema);
export const agentConfigurationsSchema = z.array(agentConfigurationSchema);
export const providerSummariesSchema = z.array(providerSummarySchema);

export const providerKeyStateSchema = z.object({
  providerId: idSchema, keyReference: keyReferenceSchema.nullable(),
  state: z.enum(['missing', 'configured', 'session', 'unavailable']), storage: keyStorageStatusSchema,
}).strict().refine((input) => (input.state === 'missing') === (input.keyReference === null)
  && (input.state !== 'configured' || input.storage.mode === 'secure')
  && (input.state !== 'session' || input.storage.mode === 'memory'), 'Inconsistent key state');
export const providerIdInputSchema = z.object({ providerId: idSchema }).strict();
export const confirmProviderTargetInputSchema = providerIdInputSchema.extend({ baseUrl: providerBaseUrlSchema, confirmed: z.literal(true) });
export const setProviderKeyInputSchema = providerIdInputSchema.extend({ apiKey: z.string().min(1) });
export const providerModelsInputSchema = providerIdInputSchema;
export const providerModelsResultSchema = providerIdInputSchema.extend({ models: z.array(providerModelSchema) });
export const providerConnectionTestInputSchema = providerIdInputSchema.extend({ level: connectionLevelSchema, modelId: idSchema.optional(), allowGeneration: z.literal(true).optional() })
  .refine((input) => input.level !== 'generation' || input.modelId !== undefined, 'Generation test requires a model');
export const providerConnectionTestResultSchema = providerIdInputSchema.extend({ result: connectionTestResultSchema });

const pageLimitSchema = z.number().int().min(1).max(500).default(100);
export const roomMessageCursorSchema = z.object({ roomId: idSchema, afterKey: sequenceSchema, throughKey: sequenceSchema }).strict()
  .refine((input) => input.afterKey <= input.throughKey, 'Cursor exceeds its upper bound');
export const roomMessagePageInputSchema = z.object({ roomId: idSchema, cursor: roomMessageCursorSchema.optional(), limit: pageLimitSchema }).strict()
  .refine((input) => input.cursor === undefined || input.cursor.roomId === input.roomId, 'Cursor belongs to another room');
export const historyMessageSchema = z.object({
  id: idSchema, roomId: idSchema, runId: idSchema.nullable(), turnId: idSchema.nullable(),
  senderType: z.enum(['user', 'agent', 'system']), senderName: z.string().trim().min(1), content: z.string(),
  status: z.enum(messageStatusValues), sortKey: sequenceSchema.refine((value) => value > 0),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict();
export const roomMessagePageSchema = z.object({ items: z.array(historyMessageSchema), nextCursor: roomMessageCursorSchema.nullable(), hasMore: z.boolean() }).strict()
  .refine((page) => (page.hasMore === (page.nextCursor !== null))
    && (page.nextCursor === null || page.items.length > 0 && page.items.at(-1)!.sortKey === page.nextCursor.afterKey)
    && page.items.every((item, index, items) => item.roomId === items[0].roomId && (index === 0 || item.sortKey > items[index - 1].sortKey)
      && (page.nextCursor === null || item.roomId === page.nextCursor.roomId && item.sortKey <= page.nextCursor.throughKey)), 'Inconsistent message page');

export const roomRunPositionSchema = z.object({ createdAt: timestampSchema, id: idSchema }).strict();
export const compareRunPositions = (left: z.infer<typeof roomRunPositionSchema>, right: z.infer<typeof roomRunPositionSchema>) =>
  left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : compareCodePoints(left.id, right.id);
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, c => c.codePointAt(0)!); const b = Array.from(right, c => c.codePointAt(0)!);
  for (let i=0; i<Math.min(a.length,b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return Math.sign(a.length-b.length);
}
export const roomRunCursorSchema = z.object({ roomId: idSchema, throughRowId: sequenceSchema.refine(n => n > 0), after: roomRunPositionSchema, through: roomRunPositionSchema }).strict()
  .refine((input) => compareRunPositions(input.after, input.through) <= 0, 'Cursor exceeds its upper bound');
export const roomRunPageInputSchema = z.object({ roomId: idSchema, cursor: roomRunCursorSchema.optional(), limit: pageLimitSchema }).strict()
  .refine((input) => input.cursor === undefined || input.cursor.roomId === input.roomId, 'Cursor belongs to another room');
export const runSummarySchema = z.object({
  id: idSchema, roomId: idSchema, status: z.enum(runStatusValues), task: z.string().nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict();
export const roomRunPageSchema = z.object({ items: z.array(runSummarySchema), nextCursor: roomRunCursorSchema.nullable(), hasMore: z.boolean() }).strict()
  .refine((page) => (page.hasMore === (page.nextCursor !== null))
    && (page.nextCursor === null || page.items.length > 0 && compareRunPositions(page.items.at(-1)!,page.nextCursor.after) === 0)
    && page.items.every((item, index, items) => item.roomId === items[0].roomId && (index === 0 || compareRunPositions(items[index - 1], item) < 0)
      && (page.nextCursor === null || item.roomId === page.nextCursor.roomId && compareRunPositions(item, page.nextCursor.through) <= 0)), 'Inconsistent run page');
