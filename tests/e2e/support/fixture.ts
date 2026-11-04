import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FixtureMode = 'ok' | 'hang';
export type FixtureService = 'deepseek' | 'kimi' | 'glm' | 'doubao' | 'qwen';
type Message = { role: string; content: string };
export type FixtureRequest = { path?: string; service: FixtureService; model: string; maxTokens: number; mode: FixtureMode; messages: Message[]; headers: IncomingHttpHeaders; raw: Record<string, any> };
type ReplyBody = { model: string; max_tokens: number; service: FixtureService; messages: Message[] };

/** A loopback server speaking the one interface, run by the test process; the app reaches it only through entry.cjs's redirect. */
export class DeepSeekFixture {
  mode: FixtureMode | ((body: ReplyBody) => FixtureMode) = 'ok';
  reply: (body: ReplyBody) => string = () => '好的。';
  /** What a compatible service streams as reasoning_content before any text. */
  reasoning: (body: ReplyBody) => string | undefined = () => undefined;
  /** Holds the reply after its reasoning, until `release`. */
  holdAfterReasoning: (body: ReplyBody) => boolean = () => false;
  finishReason: (body: ReplyBody) => 'stop' | 'length' = () => 'stop';
  chunks = 6;
  chunkMs = 20;
  readonly requests: FixtureRequest[] = [];
  private hung: (() => void)[] = [];
  private server?: Server;
  private open = new Set<ServerResponse>();

  get port() { return (this.server!.address() as AddressInfo).port; }

  /** What `GET /models` lists for a service; without it the service has no such interface. Kept apart from `requests`: nothing is generated. */
  modelList?: (service: FixtureService) => string[] | undefined;
  readonly modelListRequests: Array<{ path: string; headers: IncomingHttpHeaders }> = [];

  async start() {
    this.server = createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part as Buffer);
      const service = /^\/([a-z]+)\//u.exec(req.url ?? '')?.[1] as FixtureService;
      if (req.method === 'GET') {
        this.modelListRequests.push({ path: req.url ?? '', headers: req.headers });
        const ids = this.modelList?.(service);
        if (!ids) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) }));
        return;
      }
      const raw = JSON.parse(Buffer.concat(parts).toString()) as Record<string, any>;
      const body: ReplyBody = { model: raw.model, max_tokens: raw.max_tokens, messages: raw.messages, service };
      const mode = typeof this.mode === 'function' ? this.mode(body) : this.mode;
      this.requests.push({ path: req.url, service, model: body.model, maxTokens: body.max_tokens, mode, messages: body.messages, headers: req.headers, raw });
      this.open.add(res);
      res.on('close', () => this.open.delete(res));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (value: unknown, event?: string) => { if (!res.destroyed) res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(value)}\n\n`); };
      const reasoning = this.reasoning(body);
      if (reasoning) {
        emit({ id: 'e2e-fixture', choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }] });
        if (this.holdAfterReasoning(body)) await new Promise<void>(release => this.hung.push(release));
        if (res.destroyed) return;
      }
      const text = this.reply(body);
      const size = Math.max(1, Math.ceil(text.length / this.chunks));
      const pieces: string[] = [];
      for (let index = 0; index < text.length; index += size) pieces.push(text.slice(index, index + size));
      for (const [index, piece] of pieces.entries()) {
        emit({ id: 'e2e-fixture', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
        if (mode === 'hang' && index === Math.min(1, pieces.length - 1)) await new Promise<void>(release => this.hung.push(release));
        else await new Promise(done => setTimeout(done, this.chunkMs));
        if (res.destroyed) return;
      }
      emit({ id: 'e2e-fixture', choices: [{ index: 0, delta: {}, finish_reason: this.finishReason(body) }] });
      emit({ id: 'e2e-fixture', choices: [], usage: { prompt_tokens: 300, completion_tokens: 6, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200 } });
      if (!res.destroyed) res.end('data: [DONE]\n\n');
    });
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
