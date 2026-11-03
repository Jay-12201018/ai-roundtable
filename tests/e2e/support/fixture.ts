import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FixtureMode = 'ok' | 'hang';
export type FixtureRequest = { path?: string; model: string; maxTokens: number; mode: FixtureMode; messages: { role: string; content: string }[]; headers: IncomingHttpHeaders };
type ReplyBody = { model: string; max_tokens: number; messages: { role: string; content: string }[] };

/** A loopback server speaking DeepSeek's SSE, run by the test process; the app reaches it only through entry.cjs's redirect. */
export class DeepSeekFixture {
  mode: FixtureMode | ((body: ReplyBody) => FixtureMode) = 'ok';
  reply: (body: ReplyBody) => string = () => '好的。';
  chunks = 6;
  chunkMs = 20;
  readonly requests: FixtureRequest[] = [];
  private hung: (() => void)[] = [];
  private server?: Server;
  private open = new Set<ServerResponse>();

  get port() { return (this.server!.address() as AddressInfo).port; }

  async start() {
    this.server = createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part as Buffer);
      const body = JSON.parse(Buffer.concat(parts).toString()) as ReplyBody;
      const mode = typeof this.mode === 'function' ? this.mode(body) : this.mode;
      this.requests.push({ path: req.url, model: body.model, maxTokens: body.max_tokens, mode, messages: body.messages, headers: req.headers });
      this.open.add(res);
      res.on('close', () => this.open.delete(res));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (value: unknown) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
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
      emit({ id: 'e2e-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
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
export const memberOf = (body: ReplyBody) => /现在由你（成员「([^」]+)」/u.exec(body.messages.at(-1)?.content ?? '')?.[1];
/** The artifact kind an artifact request asks for, as the app words it. */
export const artifactOf = (body: ReplyBody) => /整理「([^」]+)」。只输出 JSON 对象。$/u.exec(body.messages.at(-1)?.content ?? '')?.[1];
