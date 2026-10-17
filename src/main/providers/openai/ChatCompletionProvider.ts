import OpenAI from 'openai';
import { z } from 'zod';
import { ContractError, toPublicError } from '../../../shared/contracts/errors';
import type { KeyReference, ProviderConfiguration } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema, providerConfigurationSchema } from '../../../shared/schemas/configuration';
import { connectionLevelSchema, listModelsInputSchema, providerModelSchema, streamChatInputSchema, testConnectionInputSchema } from '../../../shared/schemas/provider';
import { idSchema } from '../../../shared/schemas/common';
import type { ErrorCode } from '../../../shared/schemas/error';
import type { ConnectionTestResult, ListModelsInput, NormalizedChunk, ProviderAdapter, StreamChatInput, TestConnectionInput } from '../types';
import { readSse } from './sse';

export interface ChatCompletionOptions {
  configuration: ProviderConfiguration;
  /** Main attests that this exact endpoint was validated and confirmed by the user. */
  confirmedBaseUrl: string;
  resolveKey: (providerId: string, reference: KeyReference | null) => Promise<string | undefined>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export interface ChatCompletionCapabilities {
  outputTokenParameter: 'max_tokens' | 'max_completion_tokens' | null;
  streamUsage: boolean;
  listModels: boolean;
  authentication: 'models' | 'unsupported';
}
const capabilitySchema = z.object({
  outputTokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).nullable(),
  streamUsage: z.boolean(), listModels: z.boolean(), authentication: z.enum(['models', 'unsupported']),
}).strict();
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const completionChunk = z.object({
  choices: z.array(z.object({ index: z.literal(0), delta: z.object({
    role: z.literal('assistant').optional(), content: z.string().nullable().optional(),
    refusal: z.string().nullable().optional(), tool_calls: z.unknown().optional(),
    function_call: z.unknown().optional(), audio: z.unknown().optional(),
  }), finish_reason: z.string().nullable().optional() })).max(1),
  usage: z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount }).nullable().optional(),
});
const modelList = z.object({ data: z.array(z.object({ id: providerModelSchema.shape.id })).max(10000), has_more: z.boolean().optional() });
const officialBaseUrl = 'https://api.openai.com/v1';
const normalizeBase = (url: string) => providerBaseUrlSchema.parse(url).replace(/\/+$/u, '');

/** Shared transport for the two R09 text Chat Completions adapters; no registration or scheduling. */
export class ChatCompletionProvider implements ProviderAdapter {
  private readonly configuration: ProviderConfiguration;
  private readonly baseUrl: string;
  private readonly capabilities: ChatCompletionCapabilities;
  private readonly timeoutMs: number;
  private readonly resolveKey: ChatCompletionOptions['resolveKey'];
  private readonly fetcher: typeof fetch;

  protected constructor(options: ChatCompletionOptions, kind: 'openai' | 'openai-compatible', capabilities: ChatCompletionCapabilities) {
    try {
      this.configuration = providerConfigurationSchema.parse(options.configuration);
      if (this.configuration.kind !== kind || !this.configuration.enabled) throw new ContractError('invalid_state');
      if (kind === 'openai-compatible' && this.configuration.baseUrl === null) throw new ContractError('invalid_input');
      this.baseUrl = normalizeBase(this.configuration.baseUrl ?? officialBaseUrl);
      if (kind === 'openai' && this.baseUrl !== officialBaseUrl || normalizeBase(options.confirmedBaseUrl) !== this.baseUrl) throw new ContractError('invalid_input');
      this.capabilities = capabilitySchema.parse(capabilities);
      this.timeoutMs = z.number().int().min(1).max(2147483647).parse(options.timeoutMs ?? 60000);
      this.resolveKey = options.resolveKey;
      this.fetcher = options.fetch ?? globalThis.fetch;
    } catch (error) { throw new ContractError(error instanceof ContractError ? error.code : 'invalid_input'); }
  }

  async listModels(input: ListModelsInput) {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      parse(listModelsInputSchema, withoutSignal(input)); scope.check();
      if (!this.capabilities.listModels) throw new ContractError('unsupported');
      return await this.models(scope);
    } catch (error) { throw this.failure(error, scope, true); }
    finally { scope.close(); }
  }

  async testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
    parse(idSchema, input?.requestId); parse(connectionLevelSchema, input?.level);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      const parsed = parse(testConnectionInputSchema, withoutSignal(input)); scope.check();
      if (parsed.level === 'authentication') {
        if (this.capabilities.authentication !== 'models') throw new ContractError('unsupported');
        await this.models(scope);
      } else if (parsed.level === 'generation') {
        let text = false; let complete = false;
        for await (const event of this.streamChat({ requestId: parsed.requestId, modelId: parsed.modelId!,
          messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8, signal: scope.signal })) {
          scope.check();
          if (event.type === 'error') throw new ContractError(event.error.code);
          if (event.type === 'text_delta' && event.text.length > 0) text = true;
          if (event.type === 'finish') complete = event.reason === 'stop' || event.reason === 'length';
        }
        if (!text || !complete) throw new ContractError('invalid_response');
      }
      return { requestId: parsed.requestId, level: parsed.level, ok: true };
    } catch (error) { return { requestId: input.requestId, level: input.level, ok: false, error: this.failure(error, scope, input.level === 'authentication').detail }; }
    finally { scope.close(); }
  }

  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    const { requestId } = input;
    try {
      const parsed = parse(streamChatInputSchema, withoutSignal(input)); scope.check();
      if (parsed.outputTokenLimit === undefined) throw new ContractError('invalid_input');
      const outputParameter = this.capabilities.outputTokenParameter;
      if (outputParameter === null) throw new ContractError('unsupported');
      const client = await this.client(scope);
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: parsed.modelId, messages: parsed.messages, stream: true,
        [outputParameter]: parsed.outputTokenLimit,
        ...(this.capabilities.streamUsage ? { stream_options: { include_usage: true } } : {}),
      };
      const response = await scope.wait(() => client.chat.completions.create(body, { signal: scope.signal, maxRetries: 0 }).asResponse());
      scope.check();
      yield { type: 'start', requestId };
      let finish: 'stop' | 'length' | 'content_filter' | undefined;
      let used = false;
      for await (const data of readSse(response, scope.signal, () => scope.check())) {
        scope.check();
        if (data === '[DONE]') {
          if (finish === undefined) throw new ContractError('invalid_response');
          yield { type: 'finish', requestId, reason: finish }; return;
        }
        let value: unknown;
        try { value = JSON.parse(data); } catch { throw new ContractError('invalid_response'); }
        const chunk = parse(completionChunk, value, 'invalid_response');
        const choice = chunk.choices[0];
        if (choice !== undefined) {
          if (finish !== undefined) throw new ContractError('invalid_response');
          if (choice.delta.tool_calls != null || choice.delta.function_call != null || choice.delta.audio != null) throw new ContractError('unsupported');
          if (choice.finish_reason != null) {
            const reason = choice.finish_reason;
            if (reason !== 'stop' && reason !== 'length' && reason !== 'content_filter') throw new ContractError('unsupported');
            finish = reason;
          }
          if (choice.delta.content) yield { type: 'text_delta', requestId, text: choice.delta.content };
          scope.check();
          if (choice.delta.refusal) yield { type: 'text_delta', requestId, text: choice.delta.refusal };
          scope.check();
        }
        if (chunk.usage != null) {
          if (used || finish === undefined) throw new ContractError('invalid_response');
          used = true;
          yield { type: 'usage', requestId, inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
        }
      }
      throw new ContractError('invalid_response');
    } catch (error) { yield { type: 'error', requestId, error: this.failure(error, scope).detail }; }
    finally { scope.close(); }
  }

  private async client(scope: RequestScope): Promise<OpenAI> {
    const key = await scope.wait(() => this.resolveKey(this.configuration.id, this.configuration.keyReference));
    scope.check();
    if (typeof key !== 'string' || key.length === 0 || /\s|\p{Cc}/u.test(key)) throw new ContractError('authentication_failed');
    const baseUrl = this.baseUrl;
    const fetcher: typeof fetch = async (url, init) => {
      scope.check();
      const target = String(url);
      if (!(target === `${baseUrl}/models` && init?.method === 'GET'
        || target === `${baseUrl}/chat/completions` && init?.method === 'POST')) throw new ContractError('invalid_input');
      const response = await this.fetcher(url, { ...init, redirect: 'error' });
      try { scope.check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (response.redirected || response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {}); throw new ContractError('invalid_response');
      }
      if (!response.ok) {
        // Discard untrusted error bodies/headers before the SDK can retain or log credentials.
        void response.body?.cancel().catch(() => {});
        return new Response(null, { status: response.status });
      }
      return response;
    };
    return new OpenAI({ apiKey: key, baseURL: baseUrl, organization: null, project: null, webhookSecret: null,
      maxRetries: 0, timeout: this.timeoutMs, logLevel: 'off', fetch: fetcher });
  }

  private async models(scope: RequestScope) {
    const client = await this.client(scope);
    const response = await scope.wait(() => client.models.list({ signal: scope.signal, maxRetries: 0 }).asResponse());
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') || !response.body) {
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
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new ContractError('invalid_response'); }
      const result = parse(modelList, data, 'invalid_response');
      if (result.has_more) throw new ContractError('unsupported');
      if (new Set(result.data.map(m => m.id)).size !== result.data.length) throw new ContractError('invalid_response');
      return result.data.map(m => ({ id: m.id, name: m.id }));
    } catch (error) {
      if (error instanceof TypeError) throw new ContractError('invalid_response');
      throw error;
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  private failure(error: unknown, scope: RequestScope, listing = false): ContractError {
    if (scope.signal.aborted) return new ContractError(scope.signal.reason instanceof ContractError ? scope.signal.reason.code : 'cancelled');
    if (error instanceof ContractError) return new ContractError(error.code);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return new ContractError('timeout');
    if (error instanceof OpenAI.APIConnectionError && error.cause instanceof ContractError) return new ContractError(error.cause.code);
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      if (listing && (status === 404 || status === 405)) return new ContractError('unsupported');
      const code: ErrorCode = status === 401 ? 'authentication_failed' : status === 403 ? 'forbidden'
        : status === 429 ? 'rate_limited' : status === 404 ? 'not_found'
        : status !== undefined && status >= 500 ? 'internal_error'
        : status !== undefined && status >= 400 ? 'invalid_input' : 'network_error';
      return new ContractError(code);
    }
    return new ContractError(toPublicError(error, 'network_error').code);
  }
}

function withoutSignal<T extends { signal?: AbortSignal }>(input: T) { const { signal: _, ...parameters } = input; return parameters; }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: ErrorCode = 'invalid_input'): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractError(code);
  return result.data;
}

class RequestScope {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abort = () => this.controller.abort(new ContractError(
    this.parent?.reason instanceof ContractError && this.parent.reason.code === 'timeout' ? 'timeout' : 'cancelled'));
  constructor(private readonly parent: AbortSignal | undefined, timeoutMs: number) {
    this.deadline = performance.now() + timeoutMs;
    this.timer = setTimeout(() => this.controller.abort(new ContractError('timeout')), timeoutMs);
    parent?.addEventListener('abort', this.abort, { once: true });
    if (parent?.aborted) this.abort();
  }
  check() {
    if (!this.signal.aborted && performance.now() >= this.deadline) this.controller.abort(new ContractError('timeout'));
    if (this.signal.aborted) throw this.signal.reason;
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const abort = () => { this.signal.removeEventListener('abort', abort); reject(this.signal.reason); };
      this.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { this.check(); return work(); }).then(value => {
        this.signal.removeEventListener('abort', abort);
        try { this.check(); resolve(value); } catch (error) { reject(error); }
      }, error => { this.signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  close() { clearTimeout(this.timer); this.parent?.removeEventListener('abort', this.abort); this.controller.abort(new ContractError('cancelled')); }
}
