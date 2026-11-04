import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ContractError, toPublicError } from '../../../shared/contracts/errors';
import type { KeyReference, ProviderConfiguration } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema, providerConfigurationSchema } from '../../../shared/schemas/configuration';
import { idSchema } from '../../../shared/schemas/common';
import { connectionLevelSchema, listModelsInputSchema, providerModelSchema, streamChatInputSchema, testConnectionInputSchema } from '../../../shared/schemas/provider';
import type { ErrorCode } from '../../../shared/schemas/error';
import type { ConnectionTestResult, ListModelsInput, NormalizedChunk, ProviderAdapter, StreamChatInput, TestConnectionInput } from '../types';
import { buildAnthropicMessages } from './messages';
import { normalizeStream } from './protocol';
import { RequestScope } from './scope';

export { buildAnthropicMessages } from './messages';
export interface AnthropicOptions {
  configuration: ProviderConfiguration;
  /** Main attests this exact endpoint was validated and explicitly confirmed. */
  confirmedBaseUrl: string;
  resolveKey: (providerId: string, reference: KeyReference | null) => Promise<string | undefined>;
  timeoutMs?: number;
  /** D135: the total for a generation stream; list and authentication calls keep `timeoutMs`. */
  streamTimeoutMs?: number;
  /** Production must inject the existing guarded/pinned Main transport. */
  fetch?: typeof fetch;
}
const officialBaseUrl = 'https://api.anthropic.com';
const normalizeBase = (url: string) => providerBaseUrlSchema.parse(url).replace(/\/+$/u, '');
const modelList = z.object({
  data: z.array(z.object({ id: providerModelSchema.shape.id, display_name: providerModelSchema.shape.name })).max(1000),
  has_more: z.boolean(), last_id: idSchema.nullable().optional(),
});
const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

/** Main-only native Messages adapter; registration, authorization and policies stay in Registry. */
export class AnthropicProvider implements ProviderAdapter {
  private readonly configuration: ProviderConfiguration;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly streamTimeoutMs: number;
  private readonly resolveKey: AnthropicOptions['resolveKey'];
  private readonly fetcher: typeof fetch;

  constructor(options: AnthropicOptions) {
    try {
      this.configuration = providerConfigurationSchema.parse(options.configuration);
      if (this.configuration.kind !== 'anthropic' || !this.configuration.enabled) throw new ContractError('invalid_state');
      this.baseUrl = normalizeBase(this.configuration.baseUrl ?? officialBaseUrl);
      if (normalizeBase(options.confirmedBaseUrl) !== this.baseUrl) throw new ContractError('invalid_input');
      this.timeoutMs = z.number().int().min(1).max(2147483647).parse(options.timeoutMs ?? 60000);
      this.streamTimeoutMs = z.number().int().min(1).max(2147483647).parse(options.streamTimeoutMs ?? this.timeoutMs);
      this.resolveKey = options.resolveKey;
      this.fetcher = options.fetch ?? globalThis.fetch;
    } catch (error) { throw new ContractError(error instanceof ContractError ? error.code : 'invalid_input'); }
  }

  async listModels(input: ListModelsInput) {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      parse(listModelsInputSchema, withoutSignal(input)); scope.check();
      return await this.models(scope);
    } catch (error) { throw this.failure(error, scope, true); }
    finally { scope.close(); }
  }

  async testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
    parse(idSchema, input?.requestId); parse(connectionLevelSchema, input?.level);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      const parsed = parse(testConnectionInputSchema, withoutSignal(input)); scope.check();
      if (parsed.level === 'authentication') await this.models(scope);
      else if (parsed.level === 'generation') {
        let complete = false;
        for await (const event of this.streamChat({ requestId: parsed.requestId, modelId: parsed.modelId!,
          messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8, signal: scope.signal })) {
          scope.check();
          if (event.type === 'error') throw new ContractError(event.error.code);
          if (event.type === 'finish') complete = event.reason === 'stop' || event.reason === 'length';
        }
        if (!complete) throw new ContractError('invalid_response');
      }
      scope.check();
      return { requestId: parsed.requestId, level: parsed.level, ok: true };
    } catch (error) { return { requestId: input.requestId, level: input.level, ok: false, error: this.failure(error, scope, input.level === 'authentication').detail }; }
    finally { scope.close(); }
  }

  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.streamTimeoutMs);
    try {
      const parsed = parse(streamChatInputSchema, withoutSignal(input)); scope.check();
      if (parsed.outputTokenLimit === undefined) throw new ContractError('invalid_input');
      const body: Anthropic.MessageCreateParamsStreaming = {
        model: parsed.modelId, ...buildAnthropicMessages(parsed.messages), stream: true,
        max_tokens: parsed.outputTokenLimit,
      };
      const client = await this.client(scope);
      // messages.create directly console.warns deprecated IDs even with SDK logging off.
      const response = await scope.wait(() => client.post('/v1/messages', {
        body, stream: true, signal: scope.signal, maxRetries: 0,
      }).asResponse());
      scope.check();
      yield* normalizeStream(response, parsed.requestId, scope);
    } catch (error) { yield { type: 'error', requestId: input.requestId, error: this.failure(error, scope).detail }; }
    finally { scope.close(); }
  }

  private async client(scope: RequestScope) {
    const key = await scope.wait(() => this.resolveKey(this.configuration.id, this.configuration.keyReference));
    scope.check();
    if (typeof key !== 'string' || !key.length || /\s|\p{Cc}/u.test(key)) throw new ContractError('authentication_failed');
    const fetcher: typeof fetch = async (url, init) => {
      scope.check();
      const target = new URL(String(url));
      const base = new URL(`${this.baseUrl}/`);
      const path = target.pathname.startsWith(base.pathname) ? target.pathname.slice(base.pathname.length) : '';
      const list = path === 'v1/models' && init?.method === 'GET'
        && target.searchParams.get('limit') === '1000'
        && [...target.searchParams.keys()].every(name => name === 'limit' || name === 'after_id');
      const generate = path === 'v1/messages' && !target.search && init?.method === 'POST';
      if (target.origin !== base.origin || target.username || target.password || target.hash || !list && !generate) throw new ContractError('invalid_input');
      const response = await this.fetcher(url, { ...init, redirect: 'error' });
      try { scope.check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (response.redirected || response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {}); throw new ContractError('invalid_response');
      }
      if (!response.ok) {
        // Discard untrusted error bodies/headers before SDK error parsing or logging.
        void response.body?.cancel().catch(() => {});
        return new Response(null, { status: response.status });
      }
      return response;
    };
    return new Anthropic({ apiKey: key, authToken: null, baseURL: this.baseUrl, maxRetries: 0,
      // The scope ends every call at its own total, so the SDK's limit only has to allow the longest of them.
      timeout: this.streamTimeoutMs, logLevel: 'off', logger: silentLogger, fetch: fetcher });
  }

  private async models(scope: RequestScope) {
    const client = await this.client(scope);
    const models: Array<{ id: string; name: string }> = [];
    const ids = new Set<string>(); const cursors = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const response = await scope.wait(() => client.models.list({ limit: 1000, ...(after ? { after_id: after } : {}) },
        { signal: scope.signal, maxRetries: 0 }).asResponse());
      const body = parse(modelList, await readJson(response, scope), 'invalid_response');
      for (const model of body.data) {
        if (ids.has(model.id) || models.length >= 10000) throw new ContractError('invalid_response');
        ids.add(model.id); models.push({ id: model.id, name: model.display_name });
      }
      if (!body.has_more) { scope.check(); return models; }
      if (!body.data.length || !body.last_id || body.last_id !== body.data.at(-1)!.id || cursors.has(body.last_id)) throw new ContractError('invalid_response');
      after = body.last_id; cursors.add(after);
    }
    throw new ContractError('invalid_response');
  }

  private failure(error: unknown, scope: RequestScope, listing = false): ContractError {
    if (scope.signal.aborted) return new ContractError(scope.signal.reason instanceof ContractError ? scope.signal.reason.code : 'cancelled');
    if (error instanceof ContractError) return new ContractError(error.code);
    if (error instanceof Anthropic.APIConnectionTimeoutError) return new ContractError('timeout');
    if (error instanceof Anthropic.APIConnectionError && error.cause instanceof ContractError) return new ContractError(error.cause.code);
    if (error instanceof Anthropic.APIError) {
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
async function readJson(response: Response, scope: RequestScope): Promise<unknown> {
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
    try { return JSON.parse(text); } catch { throw new ContractError('invalid_response'); }
  } catch (error) {
    if (error instanceof TypeError) throw new ContractError('invalid_response');
    throw error;
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
