import type { Content, Part, GenerateContentConfig } from '@google/genai';
import { z } from 'zod';
import { ContractError } from '../../../shared/contracts/errors';
import type { KeyReference, ProviderConfiguration } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema, providerConfigurationSchema } from '../../../shared/schemas/configuration';
import { connectionLevelSchema, listModelsInputSchema, providerModelSchema, streamChatInputSchema, testConnectionInputSchema } from '../../../shared/schemas/provider';
import { idSchema } from '../../../shared/schemas/common';
import type { ErrorCode } from '../../../shared/schemas/error';
import type { ConnectionTestResult, ListModelsInput, NormalizedChunk, ProviderAdapter, StreamChatInput, TestConnectionInput } from '../types';
import { createSafeFetch } from '../network';
import { readSse } from '../openai/sse';
import { RequestScope } from './requestScope';
import { finishReason, httpFailure, publicParts, responseSchema, validateUsage, type Usage } from './response';

export interface GeminiOptions {
  configuration: ProviderConfiguration;
  /** Main attests the exact official endpoint and guards Key revision/target at each transport boundary. */
  confirmedBaseUrl: string;
  resolveKey: (providerId: string, reference: KeyReference | null) => Promise<string | undefined>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
const officialBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const normalizeBase = (value: string) => providerBaseUrlSchema.parse(value).replace(/\/+$/u, '');
const modelListSchema = z.object({
  error: responseSchema.shape.error,
  models: z.array(z.object({ name: z.string(), displayName: z.string().trim().min(1).optional(), supportedGenerationMethods: z.array(z.string()).optional() })).max(10000).optional(),
  nextPageToken: z.string().max(4096).optional(),
});

/** Text-only native Gemini REST, using R09 transport and the existing Shared Adapter contract. */
export class GeminiProvider implements ProviderAdapter {
  private readonly configuration: ProviderConfiguration;
  private readonly timeoutMs: number;
  private readonly resolveKey: GeminiOptions['resolveKey'];
  private readonly fetcher: typeof fetch;
  constructor(options: GeminiOptions) {
    try {
      this.configuration = providerConfigurationSchema.parse(options.configuration);
      if (this.configuration.kind !== 'gemini' || !this.configuration.enabled) throw new ContractError('invalid_state');
      if (normalizeBase(this.configuration.baseUrl ?? officialBaseUrl) !== officialBaseUrl
        || normalizeBase(options.confirmedBaseUrl) !== officialBaseUrl) throw new ContractError('invalid_input');
      this.timeoutMs = z.number().int().min(1).max(2147483647).parse(options.timeoutMs ?? 60000);
      this.resolveKey = options.resolveKey;
      this.fetcher = options.fetch ?? createSafeFetch();
    } catch (error) { throw new ContractError(error instanceof ContractError ? error.code : 'invalid_input'); }
  }

  async listModels(input: ListModelsInput) {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try { parse(listModelsInputSchema, withoutSignal(input)); scope.check(); return await this.models(scope); }
    catch (error) { throw failure(error, scope); }
    finally { scope.close(); }
  }

  async testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
    parse(idSchema, input?.requestId); parse(connectionLevelSchema, input?.level);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      const parsed = parse(testConnectionInputSchema, withoutSignal(input)); scope.check();
      if (parsed.level === 'authentication') await this.models(scope);
      if (parsed.level === 'generation') {
        let text = false; let complete = false;
        for await (const event of this.streamChat({ requestId: parsed.requestId, modelId: parsed.modelId!,
          messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8, signal: scope.signal })) {
          scope.check();
          if (event.type === 'error') throw new ContractError(event.error.code);
          if (event.type === 'text_delta' && event.text.length) text = true;
          if (event.type === 'finish') complete = event.reason === 'stop' || event.reason === 'length';
        }
        if (!text || !complete) throw new ContractError('invalid_response');
      }
      return { requestId: parsed.requestId, level: parsed.level, ok: true };
    } catch (error) { return { requestId: input.requestId, level: input.level, ok: false, error: failure(error, scope).detail }; }
    finally { scope.close(); }
  }

  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    const { requestId } = input;
    try {
      const parsed = parse(streamChatInputSchema, withoutSignal(input)); scope.check();
      const model = modelId(parsed.modelId);
      if (parsed.outputTokenLimit === undefined) throw new ContractError('invalid_input');
      const contents: Content[] = []; const system: Part[] = [];
      for (const message of parsed.messages) {
        if (message.role === 'system') {
          if (contents.length) throw new ContractError('invalid_input');
          system.push({ text: message.content });
        } else {
          const role = message.role === 'assistant' ? 'model' : 'user';
          const previous = contents.at(-1);
          if (previous?.role === role) previous.parts!.push({ text: message.content });
          else contents.push({ role, parts: [{ text: message.content }] });
        }
      }
      if (!contents.length) throw new ContractError('invalid_input');
      const generationConfig = { candidateCount: 1, maxOutputTokens: parsed.outputTokenLimit } satisfies GenerateContentConfig;
      const body = { contents, ...(system.length ? { systemInstruction: { parts: system } } : {}), generationConfig };
      const key = await this.key(scope);
      const response = await this.request(scope, `/models/${model}:streamGenerateContent?alt=sse`, key, JSON.stringify(body));
      let finish: 'stop' | 'length' | 'content_filter' | undefined;
      let started = false; let text = false; let thoughts = false; let usage: Usage | undefined; let observed: Usage = {};
      for await (const data of readSse(response, scope.signal, () => scope.check())) {
        scope.check();
        let value: unknown;
        try { value = JSON.parse(data); } catch { throw new ContractError('invalid_response'); }
        const chunk = parse(responseSchema, value, 'invalid_response');
        if (chunk.error) throw httpFailure(chunk.error.code);
        if (!started) {
          started = true;
          yield { type: 'start', requestId, ...(chunk.responseId === undefined ? {} : { providerRequestId: chunk.responseId }) };
          scope.check();
        }
        if (finish !== undefined && (chunk.candidates?.length || chunk.promptFeedback !== undefined)) throw new ContractError('invalid_response');
        const reason = finishReason(chunk);
        if (reason !== undefined) finish = reason;
        thoughts ||= chunk.candidates?.some(c => c.content?.parts?.some(p => p.thought === true)) ?? false;
        if (chunk.usageMetadata !== undefined) {
          validateUsage(chunk.usageMetadata, observed);
          observed = { ...observed, ...chunk.usageMetadata };
          if (finish !== undefined) usage = chunk.usageMetadata;
        }
        if (reason !== 'content_filter') {
          for (const part of publicParts(chunk)) {
            scope.check(); text = true; yield { type: 'text_delta', requestId, text: part };
          }
        }
      }
      scope.check();
      if (finish === undefined || finish === 'stop' && !text) throw new ContractError('invalid_response');
      if (usage?.promptTokenCount !== undefined && usage.candidatesTokenCount !== undefined
        && (!(thoughts || observed.thoughtsTokenCount !== undefined) || usage.thoughtsTokenCount !== undefined)) {
        // Native candidates and thoughts are disjoint output counts; cached prompt tokens are already included.
        yield { type: 'usage', requestId, inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) };
      }
      scope.check(); yield { type: 'finish', requestId, reason: finish };
    } catch (error) { yield { type: 'error', requestId, error: failure(error, scope).detail }; }
    finally { scope.close(); }
  }

  private async key(scope: RequestScope): Promise<string> {
    const key = await scope.wait(() => this.resolveKey(this.configuration.id, this.configuration.keyReference)); scope.check();
    if (typeof key !== 'string' || !key || /\s|\p{Cc}/u.test(key)) throw new ContractError('authentication_failed');
    return key;
  }

  private request(scope: RequestScope, path: string, key: string, body?: string): Promise<Response> {
    return scope.wait(async () => {
      scope.check();
      const response = await this.fetcher(`${officialBaseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json', accept: body === undefined ? 'application/json' : 'text/event-stream' },
        ...(body === undefined ? {} : { body }), signal: scope.signal, redirect: 'error',
      });
      try {
        scope.check();
        if (response.redirected || response.status >= 300 && response.status < 400) throw new ContractError('invalid_response');
        if (!response.ok) {
          throw httpFailure(response.status);
        }
        return response;
      } catch (error) {
        // Never buffer untrusted error bodies or headers, including late responses after cancellation.
        void response.body?.cancel().catch(() => {}); throw error;
      }
    });
  }

  private async models(scope: RequestScope) {
    const key = await this.key(scope);
    const result: Array<{ id: string; name: string }> = []; const ids = new Set<string>(); const pages = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ pageSize: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await this.request(scope, `/models?${query}`, key);
      const body = parse(modelListSchema, await readJson(response, scope), 'invalid_response');
      if (body.error) throw httpFailure(body.error.code);
      for (const model of body.models ?? []) {
        let id: string;
        try { if (!model.name.startsWith('models/')) throw new Error(); id = modelId(model.name); }
        catch { throw new ContractError('invalid_response'); }
        if (ids.has(id) || ids.size >= 10000) throw new ContractError('invalid_response');
        ids.add(id);
        if (model.supportedGenerationMethods?.includes('generateContent')) result.push(parse(providerModelSchema, { id, name: model.displayName ?? id }, 'invalid_response'));
      }
      if (!body.nextPageToken) return result;
      if (pages.has(body.nextPageToken)) throw new ContractError('invalid_response');
      pages.add(body.nextPageToken); pageToken = body.nextPageToken;
    }
    throw new ContractError('invalid_response');
  }
}

function modelId(value: string): string {
  parse(idSchema, value);
  const match = /^(?:models\/)?([a-zA-Z0-9][a-zA-Z0-9._-]*)$/u.exec(value);
  if (!match) throw new ContractError('invalid_input');
  return match[1];
}
function withoutSignal<T extends { signal?: AbortSignal }>(input: T) { const { signal: _, ...parameters } = input; return parameters; }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: ErrorCode = 'invalid_input'): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ContractError(code);
  return parsed.data;
}
function failure(error: unknown, scope: RequestScope): ContractError {
  return new ContractError(scope.signal.aborted ? scope.signal.reason instanceof ContractError && scope.signal.reason.code === 'timeout' ? 'timeout' : 'cancelled'
    : error instanceof ContractError ? error.code : 'network_error');
}
async function readJson(response: Response, scope: RequestScope): Promise<unknown> {
  if (!response.body || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) {
    void response.body?.cancel().catch(() => {}); throw new ContractError('invalid_response');
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = ''; let bytes = 0;
  try {
    while (true) {
      const next = await scope.wait(() => reader.read());
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new ContractError('invalid_response');
      try { text += decoder.decode(next.value, { stream: true }); } catch { throw new ContractError('invalid_response'); }
    }
    try { text += decoder.decode(); return JSON.parse(text); } catch { throw new ContractError('invalid_response'); }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
