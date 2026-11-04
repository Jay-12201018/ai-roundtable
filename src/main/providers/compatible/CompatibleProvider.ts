import { z } from 'zod';
import { ContractError, toPublicError } from '../../../shared/contracts/errors';
import type { KeyReference, ProviderConfiguration } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema, providerConfigurationSchema } from '../../../shared/schemas/configuration';
import { connectionLevelSchema, streamChatInputSchema, testConnectionInputSchema } from '../../../shared/schemas/provider';
import { idSchema, looksLikeApiKey } from '../../../shared/schemas/common';
import type { ErrorCode } from '../../../shared/schemas/error';
import type { ConnectionTestResult, NormalizedChunk, ProviderAdapter, ProviderMessage, StreamChatInput, TestConnectionInput } from '../types';
import { readSse } from './sse';
import type { DiagnosticObserver } from '../diagnostics';

export interface CompatibleOptions {
  configuration: ProviderConfiguration;
  /** Main attests that this exact endpoint was validated and confirmed by the user. */
  confirmedBaseUrl: string;
  resolveKey: (providerId: string, reference: KeyReference | null) => Promise<string | undefined>;
  timeoutMs?: number;
  /** D135: the total for a generation stream. */
  streamTimeoutMs?: number;
  fetch?: typeof fetch;
  diagnostics?: DiagnosticObserver;
  /** D147: a stored image's bytes, read only when the request is written. */
  readImage?: (attachmentId: string) => Promise<Uint8Array>;
}
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const completionChunk = z.object({
  choices: z.array(z.object({ index: z.literal(0), delta: z.object({
    role: z.string().nullable().optional(), content: z.string().nullable().optional(),
    refusal: z.string().nullable().optional(), tool_calls: z.unknown().optional(),
    function_call: z.unknown().optional(), audio: z.unknown().optional(),
  }).nullish(), finish_reason: z.string().nullable().optional() })).max(1),
  // Some services also report how much of the prompt hit a context cache (hit + miss = prompt_tokens).
  usage: z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount,
    prompt_cache_hit_tokens: tokenCount.optional(), prompt_cache_miss_tokens: tokenCount.optional() }).nullable().optional(),
});
const modelList = z.object({ data: z.array(z.object({ id: z.string() })).max(10000) });
const thinkOpen = '<think>';
const thinkClose = '</think>';

/**
 * D135: some services write their thinking as a `<think>` block at the start of the reply. It is dropped as it streams and
 * never stored, whichever chunks the tags fall into. Only the start of a reply counts; the same words later on are text.
 */
class LeadingThink {
  private state: 'start' | 'inside' | 'after' | 'body' = 'start';
  private held = '';
  push(text: string): string {
    if (this.state === 'body') return text;
    this.held += text;
    if (this.state === 'start') {
      const trimmed = this.held.trimStart();
      if (thinkOpen.startsWith(trimmed)) return '';
      if (!trimmed.startsWith(thinkOpen)) { this.state = 'body'; return this.take(this.held); }
      this.state = 'inside'; this.held = trimmed.slice(thinkOpen.length);
    }
    if (this.state === 'inside') {
      const end = this.held.indexOf(thinkClose);
      // Only what could be the first part of the closing tag is kept.
      if (end < 0) { this.held = this.held.slice(-(thinkClose.length - 1)); return ''; }
      this.state = 'after'; this.held = this.held.slice(end + thinkClose.length);
    }
    this.held = this.held.trimStart();
    if (!this.held) return '';
    this.state = 'body';
    return this.take(this.held);
  }
  /** The reply ended: what looked like the start of a tag was text; an unclosed block leaves nothing. */
  flush(): string {
    if (this.state !== 'start') return '';
    this.state = 'body';
    return this.take(this.held);
  }
  private take(text: string): string { this.held = ''; return text; }
}
const normalizeBase = (url: string) => providerBaseUrlSchema.parse(url).replace(/\/+$/u, '');

/** D143: the one adapter: `/chat/completions` over the safe transport Main gives it; no registration or scheduling. */
export class CompatibleProvider implements ProviderAdapter {
  private readonly configuration: ProviderConfiguration;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly streamTimeoutMs: number;
  private readonly resolveKey: CompatibleOptions['resolveKey'];
  private readonly fetcher: typeof fetch;
  private readonly diagnostics?: DiagnosticObserver;
  private readonly readImage?: CompatibleOptions['readImage'];

  constructor(options: CompatibleOptions) {
    try {
      this.configuration = providerConfigurationSchema.parse(options.configuration);
      if (this.configuration.kind !== 'compatible' || !this.configuration.enabled) throw new ContractError('invalid_state');
      if (this.configuration.baseUrl === null) throw new ContractError('invalid_input');
      this.baseUrl = normalizeBase(this.configuration.baseUrl);
      if (normalizeBase(options.confirmedBaseUrl) !== this.baseUrl) throw new ContractError('invalid_input');
      this.timeoutMs = z.number().int().min(1).max(2147483647).parse(options.timeoutMs ?? 60000);
      this.streamTimeoutMs = z.number().int().min(1).max(2147483647).parse(options.streamTimeoutMs ?? this.timeoutMs);
      this.resolveKey = options.resolveKey;
      this.fetcher = options.fetch ?? globalThis.fetch;
      this.diagnostics = options.diagnostics;
      this.readImage = options.readImage;
    } catch (error) { throw new ContractError(error instanceof ContractError ? error.code : 'invalid_input'); }
  }

  async testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
    parse(idSchema, input?.requestId); parse(connectionLevelSchema, input?.level);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      const parsed = parse(testConnectionInputSchema, withoutSignal(input)); scope.check();
      if (parsed.level === 'generation') {
        // D135: a model that thinks first can spend all eight tokens on it; a clean end is what shows the connection works.
        let complete = false;
        for await (const event of this.streamChat({ requestId: parsed.requestId, modelId: parsed.modelId!,
          messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8, signal: scope.signal })) {
          scope.check();
          if (event.type === 'error') throw new ContractError(event.error.code, undefined, event.error.upstream);
          if (event.type === 'finish') complete = event.reason === 'stop' || event.reason === 'length';
        }
        if (!complete) throw new ContractError('invalid_response');
      }
      return { requestId: parsed.requestId, level: parsed.level, ok: true };
    } catch (error) { return { requestId: input.requestId, level: input.level, ok: false, error: this.failure(error, scope).detail }; }
    finally { scope.close(); }
  }

  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.streamTimeoutMs);
    const { requestId } = input;
    let parsingStream = false;
    try {
      const parsed = parse(streamChatInputSchema, withoutSignal(input)); scope.check();
      if (parsed.outputTokenLimit === undefined) throw new ContractError('invalid_input');
      const body = {
        model: parsed.modelId, messages: await scope.wait(() => this.wireMessages(parsed.messages)), stream: true, max_tokens: parsed.outputTokenLimit,
        stream_options: { include_usage: true },
      };
      const response = await this.send(scope, { method: 'POST', body: JSON.stringify(body) });
      scope.check();
      parsingStream = true;
      this.diagnostics?.({ stage: 'stream' });
      yield { type: 'start', requestId };
      let finish: 'stop' | 'length' | 'content_filter' | undefined;
      // D135: compatible services may repeat usage or send it before finish_reason; the last one before the end counts.
      let usage: Extract<NormalizedChunk, { type: 'usage' }> | undefined;
      const think = new LeadingThink();
      try {
        for await (const data of readSse(response, scope.signal, () => scope.check())) {
          scope.check();
          if (data === '[DONE]') break;
          let value: unknown;
          try { value = JSON.parse(data); } catch { throw new ContractError('invalid_response'); }
          const chunk = parse(completionChunk, value, 'invalid_response');
          const choice = chunk.choices[0];
          // D135: once finish_reason has arrived the reply is whole; only usage can still follow.
          if (choice !== undefined && finish === undefined) {
            const delta = choice.delta;
            if (delta?.tool_calls != null || delta?.function_call != null || delta?.audio != null) throw new ContractError('unsupported');
            if (choice.finish_reason) {
              const reason = choice.finish_reason;
              if (reason === 'tool_calls' || reason === 'function_call') throw new ContractError('unsupported');
              // Any other reason a service names still ended the reply normally, and what arrived is kept.
              finish = reason === 'length' || reason === 'content_filter' ? reason : 'stop';
            }
            const text = delta?.content ? think.push(delta.content) : '';
            if (text) yield { type: 'text_delta', requestId, text };
            scope.check();
            if (delta?.refusal) yield { type: 'text_delta', requestId, text: delta.refusal };
            scope.check();
          }
          if (chunk.usage != null) {
            const { prompt_tokens: inputTokens, prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: miss } = chunk.usage;
            // A cache split is kept only when it is complete and adds up.
            const cacheHitInputTokens = hit !== undefined && miss !== undefined && hit + miss === inputTokens ? hit : undefined;
            usage = { type: 'usage', requestId, inputTokens, outputTokens: chunk.usage.completion_tokens, ...(cacheHitInputTokens === undefined ? {} : { cacheHitInputTokens }) };
          }
        }
      } catch (error) {
        // A malformed tail after finish_reason does not undo a whole reply; before it, the stream has no end.
        if (finish === undefined || !(error instanceof ContractError) || error.code !== 'invalid_response') throw error;
      }
      if (finish === undefined) throw new ContractError('invalid_response');
      const rest = think.flush();
      if (rest) { yield { type: 'text_delta', requestId, text: rest }; scope.check(); }
      if (usage) { yield usage; scope.check(); }
      yield { type: 'finish', requestId, reason: finish };
    } catch (error) {
      const failure = this.failure(error, scope);
      if (failure.code === 'cancelled' || failure.code === 'timeout') this.diagnostics?.({ category: failure.code === 'timeout' ? 'request_timeout' : 'cancelled' });
      else if (failure.code === 'invalid_response' || parsingStream && failure.code === 'unsupported') this.diagnostics?.({ stage: 'stream', category: 'response_invalid' });
      else if (error instanceof ContractError && ['forbidden', 'invalid_input', 'unsupported', 'invalid_state', 'attachment_missing'].includes(error.code)) this.diagnostics?.({ category: 'policy_rejected' });
      else this.diagnostics?.({ category: 'network_unknown' });
      yield { type: 'error', requestId, error: failure.detail };
    }
    finally { scope.close(); }
  }

  /** D143: the model IDs the service lists for this Key. Nothing is generated. */
  async listModels(input: { requestId: string; signal?: AbortSignal }): Promise<string[]> {
    parse(idSchema, input?.requestId);
    const scope = new RequestScope(input.signal, this.timeoutMs);
    try {
      const response = await this.send(scope, { method: 'GET' });
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
        return [...new Set(parse(modelList, data, 'invalid_response').data.map(model => model.id))];
      } catch (error) {
        if (error instanceof TypeError) throw new ContractError('invalid_response');
        throw error;
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) { throw this.failure(error, scope); }
    finally { scope.close(); }
  }

  /**
   * D147: an image goes out as a base64 data URL in an `image_url` part. This is the only place its bytes meet a request:
   * snapshots keep the reference, and nothing here reaches diagnostics or an error. An image that cannot be read stops the
   * request before anything is sent, instead of asking the model about a picture it never got.
   */
  private async wireMessages(messages: readonly ProviderMessage[]) {
    return Promise.all(messages.map(async message => {
      if (typeof message.content === 'string') return message;
      const content = await Promise.all(message.content.map(async part => {
        if (part.type === 'text') return part;
        let bytes: Uint8Array;
        try {
          if (!this.readImage) throw new Error('No image reader');
          bytes = await this.readImage(part.attachmentId);
        } catch { throw new ContractError('attachment_missing'); }
        return { type: 'image_url' as const, image_url: { url: `data:${part.mediaType};base64,${Buffer.from(bytes).toString('base64')}` } };
      }));
      return { role: message.role, content };
    }));
  }

  /** One request, never repeated. The Key goes in one header; an error's body and headers are dropped unread. */
  private async send(scope: RequestScope, init: { method: 'POST'; body: string } | { method: 'GET' }): Promise<Response> {
    this.diagnostics?.({ stage: 'credential' });
    let key: string | undefined;
    try { key = await scope.wait(() => this.resolveKey(this.configuration.id, this.configuration.keyReference)); scope.check(); }
    catch (error) {
      this.diagnostics?.({ stage: 'credential', category: scope.signal.aborted ? scope.signal.reason instanceof ContractError && scope.signal.reason.code === 'timeout' ? 'request_timeout' : 'cancelled' : 'credential_read_failed' });
      throw error;
    }
    if (typeof key !== 'string' || key.length === 0 || /\s|\p{Cc}/u.test(key)) {
      this.diagnostics?.({ stage: 'credential', category: 'credential_unavailable' }); throw new ContractError('authentication_failed');
    }
    this.diagnostics?.({ stage: 'network_client', evidence: 'client_invoked' });
    const headers: Record<string, string> = init.method === 'GET' ? { authorization: `Bearer ${key}`, accept: 'application/json' } : { authorization: `Bearer ${key}`, accept: 'text/event-stream', 'content-type': 'application/json' };
    const pending = this.fetcher(`${this.baseUrl}${init.method === 'GET' ? '/models' : '/chat/completions'}`, { ...init, headers, redirect: 'error', signal: scope.signal });
    // A transport that ignored the signal may still answer after the deadline; nothing reads that body.
    void pending.then(late => { if (scope.signal.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
    const response = await scope.wait(() => pending);
    if (response.status >= 100 && response.status <= 599) this.diagnostics?.({ stage: 'response', evidence: 'http_response', httpStatus: response.status });
    else this.diagnostics?.({ stage: 'response', category: 'response_invalid' });
    try { scope.check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
    if (response.ok) return response;
    this.diagnostics?.({ stage: 'response', category: 'http_error' });
    // A redirect is no statement from the service: its body is not read, and it is not followed.
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); throw new ContractError('invalid_response', undefined, { status: response.status }); }
    // An error body is untrusted and may echo a Key: only a code-shaped value is taken from it, and its words are never kept.
    throw new ContractError(statusCode(response.status), undefined, { status: response.status, ...await errorCodeOf(response, scope, key) });
  }

  private failure(error: unknown, scope: RequestScope): ContractError {
    if (scope.signal.aborted) return new ContractError(scope.signal.reason instanceof ContractError ? scope.signal.reason.code : 'cancelled');
    if (error instanceof ContractError) return new ContractError(error.code, undefined, error.detail.upstream);
    // The transport's own connection timeout, told apart by its cause; the text goes no further.
    if (error instanceof TypeError && error.cause instanceof Error && /time(?:d)?\s*-?out/iu.test(error.cause.message)) return new ContractError('timeout');
    return new ContractError(toPublicError(error, 'network_error').code);
  }
}

const upstreamCode = /^[A-Za-z0-9_.-]{1,64}$/u;
const errorBodyBytes = 64 * 1024;
const errorBodyMs = 2_000;
/** The service's own error code, from where these services put it. A body that is long or slow to end costs the code, not the failure. */
async function errorCodeOf(response: Response, scope: RequestScope, key: string): Promise<{ code?: string }> {
  if (!response.body) return {};
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('late')), errorBodyMs); });
  try {
    let text = ''; let bytes = 0;
    while (true) {
      const next = await Promise.race([scope.wait(() => reader.read()), late]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > errorBodyBytes) return {};
      text += decoder.decode(next.value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode()) as { error?: { code?: unknown; type?: unknown }; code?: unknown } | null;
    for (const value of [body?.error?.code, body?.error?.type, body?.code]) {
      const code = typeof value === 'number' ? String(value) : value;
      if (typeof code === 'string' && upstreamCode.test(code) && !code.includes(key) && !looksLikeApiKey(code)) return { code };
    }
    return {};
  } catch { return {}; } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function statusCode(status: number): ErrorCode {
  return status === 401 ? 'authentication_failed' : status === 403 ? 'forbidden' : status === 429 ? 'rate_limited' : status === 404 ? 'not_found'
    : status >= 500 ? 'internal_error' : status >= 400 ? 'invalid_input' : 'network_error';
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
