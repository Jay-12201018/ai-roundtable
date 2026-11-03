import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FixtureMode = 'ok' | 'hang';
export type FixtureService = 'deepseek' | 'anthropic' | 'gemini' | 'compatible';
type Message = { role: string; content: string };
export type FixtureRequest = { path?: string; service: FixtureService; model: string; maxTokens: number; mode: FixtureMode; messages: Message[]; headers: IncomingHttpHeaders; raw: Record<string, any> };
type ReplyBody = { model: string; max_tokens: number; service: FixtureService; messages: Message[] };

/** The wire of any of the four protocols, as the same three facts: which model, how long and what it says. */
function normalized(service: FixtureService, url: string, raw: Record<string, any>): Omit<ReplyBody, 'service'> {
  if (service === 'gemini') return { model: /models\/([^:]+):/u.exec(url)?.[1] ?? '', max_tokens: raw.generationConfig?.maxOutputTokens,
    messages: (raw.contents as Array<{ role: string; parts: Array<{ text: string }> }>).map(content => ({ role: content.role, content: content.parts.map(part => part.text).join('') })) };
  if (service === 'anthropic') return { model: raw.model, max_tokens: raw.max_tokens, messages: raw.messages };
  return { model: raw.model, max_tokens: raw.max_tokens, messages: raw.messages };
}

/** A loopback server speaking each service's SSE, run by the test process; the app reaches it only through entry.cjs's redirect. */
export class DeepSeekFixture {
  mode: FixtureMode | ((body: ReplyBody) => FixtureMode) = 'ok';
  reply: (body: ReplyBody) => string = () => '好的。';
  chunks = 6;
  chunkMs = 20;
  readonly requests: FixtureRequest[] = [];
  connects = 0;
  private hung: (() => void)[] = [];
  private server?: Server;
  private open = new Set<ServerResponse>();

  get port() { return (this.server!.address() as AddressInfo).port; }

  async start() {
    this.server = createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part as Buffer);
      const service = /^\/([a-z]+)\//u.exec(req.url ?? '')?.[1] as FixtureService;
      const models = { deepseek: ['deepseek-flash', 'deepseek-v4-pro'], anthropic: ['gateway-a'], gemini: ['gateway-b'], compatible: ['company-model'] }[service] ?? [];
      if (req.method === 'GET') {
        this.requests.push({ path: req.url, service, model: '', maxTokens: 0, mode: 'ok', messages: [], headers: req.headers, raw: {} });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(service === 'anthropic' ? { data: models.map(id => ({ id, display_name: id })), has_more: false }
          : service === 'gemini' ? { models: models.map(id => ({ name: `models/${id}`, displayName: id, supportedGenerationMethods: ['generateContent'] })) }
          : { data: models.map(id => ({ id })) }));
        return;
      }
      const raw = JSON.parse(Buffer.concat(parts).toString()) as Record<string, any>;
      const body: ReplyBody = { ...normalized(service, req.url ?? '', raw), service };
      const mode = typeof this.mode === 'function' ? this.mode(body) : this.mode;
      this.requests.push({ path: req.url, service, model: body.model, maxTokens: body.max_tokens, mode, messages: body.messages, headers: req.headers, raw });
      this.open.add(res);
      res.on('close', () => this.open.delete(res));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (value: unknown, event?: string) => { if (!res.destroyed) res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(value)}\n\n`); };
      const text = this.reply(body);
      const size = Math.max(1, Math.ceil(text.length / this.chunks));
      const pieces: string[] = [];
      for (let index = 0; index < text.length; index += size) pieces.push(text.slice(index, index + size));
      if (service === 'anthropic') {
        emit({ type: 'message_start', message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 200, output_tokens: 0 } } }, 'message_start');
        emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start');
      }
      for (const [index, piece] of pieces.entries()) {
        if (service === 'anthropic') emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }, 'content_block_delta');
        else if (service === 'gemini') emit({ responseId: 'e2e', candidates: [{ content: { role: 'model', parts: [{ text: piece }] } }] });
        else emit({ id: 'e2e-fixture', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
        if (mode === 'hang' && index === Math.min(1, pieces.length - 1)) await new Promise<void>(release => this.hung.push(release));
        else await new Promise(done => setTimeout(done, this.chunkMs));
        if (res.destroyed) return;
      }
      if (service === 'anthropic') {
        emit({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
        emit({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }, 'message_delta');
        emit({ type: 'message_stop' }, 'message_stop');
        if (!res.destroyed) res.end();
        return;
      }
      if (service === 'gemini') {
        emit({ responseId: 'e2e', candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 8, totalTokenCount: 408 } });
        if (!res.destroyed) res.end();
        return;
      }
      emit({ id: 'e2e-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      emit({ id: 'e2e-fixture', choices: [], usage: { prompt_tokens: 300, completion_tokens: 6, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200 } });
      if (!res.destroyed) res.end('data: [DONE]\n\n');
    });
    // A proxy check asks for a tunnel and goes no further; the test never sends anything through it.
    this.server.on('connect', (_request, socket) => { this.connects++; socket.end('HTTP/1.1 200 Connection Established\r\n\r\n'); });
    await new Promise<void>(done => this.server!.listen(0, '127.0.0.1', done));
    return this;
  }

  /** Lets every held reply finish. Returns how many were held. */
  release() { const waiting = this.hung.splice(0); for (const go of waiting) go(); return waiting.length; }

  async stop() {
    this.release();
    for (const res of this.open) res.destroy();
    await new Promise<void>(done => { this.server?.closeAllConnections(); this.server ? this.server.close(() => done()) : done(); });
  }
}

/** The member a discussion request is addressed to, as the app words it. */
export const memberOf = (body: Pick<ReplyBody, 'messages'>) => /现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1)?.content ?? '')?.[1];
/** The artifact kind an artifact request asks for, as the app words it. */
export const artifactOf = (body: Pick<ReplyBody, 'messages'>) => /整理「([^」]+)」。只输出 JSON 对象。$/u.exec(body.messages.at(-1)?.content ?? '')?.[1];
