// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Database } from '../../../src/main/database/Database';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ControlledTrialService, type TrialQuote } from '../../../src/main/providers/controlledTrial/ControlledTrialService';
import { createSafeFetch } from '../../../src/main/providers/network';
import { deepSeekTrialReview } from '../../../src/main/providers/controlledTrial/estimate';
const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T12:00:00Z')));
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
async function fixture(mode: 'ok' | 'missing' | 'broken' | 'hang' | 'usage-broken' | 'overrun' | 400 | 401 | 429 = 'ok', confirm: (quote: TrialQuote) => Promise<boolean> = async () => true) {
  const db = new Database(':memory:'); db.initialize(); cleanup.push(() => db.close());
  db.createProvider({ id: 'p', name: 'Exact target', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: 'deepseek-flash', name: 'Flash' }] });
  const keys = new KeyService(db, createMemoryKeyBackend()); await keys.storeKey('p', 'fake-controlled-secret');
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ body: JSON.parse(Buffer.concat(chunks).toString()), path: req.url, correctKey: req.headers.authorization === 'Bearer fake-controlled-secret' });
    if (typeof mode === 'number') { res.writeHead(mode); res.end('unsafe fake-controlled-secret'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }) + '\n\n');
    if (mode === 'hang') return;
    if (mode === 'broken') { res.end(); return; }
    const usage = mode === 'missing' ? {} : { usage: { prompt_tokens: mode === 'overrun' ? 50000 : 71, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 2 } } };
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...usage }) + '\n\n');
    res.end(mode === 'usage-broken' ? '' : 'data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const local = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => {
    const safe = createSafeFetch(guard);
    return ((url, init) => { expect(String(url)).toBe('https://api.deepseek.com/chat/completions'); return safe(local + '/chat/completions', init); }) as typeof fetch;
  } });
  registry.confirmTarget({ providerId: 'p', baseUrl: 'https://api.deepseek.com', confirmed: true });
  const service = new ControlledTrialService(db, registry, confirm); cleanup.push(() => service.shutdown());
  const reads = vi.spyOn(keys, 'resolveKey');
  return { db, keys, registry, service, calls, reads };
}
it('reserves full budget before Key/network, executes one SDK stream and accounts provider usage, not the estimate', async () => {
  const f = await fixture(); const quote = f.service.prepare('p');
  expect(quote.estimate).toMatchObject({ kind: 'estimated', strictUsable: false, calibration: 'uncalibrated' });
  expect(quote.reservedMicroCny).toBe(50000); expect(f.reads).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  const original = KeyService.prototype.resolveKey.bind(f.keys); f.reads.mockImplementation(async (...args) => { expect(f.db.listControlledTrials()[0].state).toBe('reserved'); return original(...args); });
  const saved = await f.service.execute(quote.id);
  expect(f.calls).toEqual([{ path: '/chat/completions', correctKey: true, body: { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], stream: true, max_tokens: 128, stream_options: { include_usage: true }, thinking: { type: 'disabled' } } }]);
  expect(saved).toMatchObject({ state: 'settled', outcome: 'completed', actualInputTokens: 71, actualOutputTokens: 8, accountedMicroCny: 206, observedUsage: { inputTokens: 71, outputTokens: 8 }, text: 'partial' });
  expect(saved.actualInputTokens! - saved.estimatedInputTokens).toBe(4);
  expect(JSON.stringify(saved)).not.toContain('fake-controlled-secret');
  await expect(f.service.execute(quote.id)).rejects.toMatchObject({ code: 'forbidden' }); expect(f.calls).toHaveLength(1);
});
it('requires per-request confirmation and cannot reuse cancelled permission', async () => {
  const f = await fixture('ok', async () => false); const q = f.service.prepare('p');
  await expect(f.service.execute(q.id)).rejects.toMatchObject({ code: 'forbidden' });
  await expect(f.service.execute(q.id)).rejects.toMatchObject({ code: 'forbidden' });
  expect(f.reads).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0); expect(f.db.listControlledTrials()).toEqual([]);
});
it('Stop invalidates a pending confirmation and ignores its late approval', async () => {
  let approve!: (value: boolean) => void; const f = await fixture('ok', () => new Promise(r => { approve = r; }));
  const p = f.service.execute(f.service.prepare('p').id); f.service.abort();
  await expect(p).rejects.toMatchObject({ code: 'cancelled' }); approve(true); await Promise.resolve();
  expect(f.reads).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
});
it('shutdown does not await an unresponsive confirmation or permit late requests', async () => {
  let approve!: (value: boolean) => void; const f = await fixture('ok', () => new Promise(r => { approve = r; }));
  const p = f.service.execute(f.service.prepare('p').id); const rejected = expect(p).rejects.toMatchObject({ code: 'cancelled' });
  await f.service.shutdown(); await rejected; approve(true); await Promise.resolve(); expect(f.calls).toHaveLength(0);
});
it.each(['missing', 'broken', 'usage-broken', 400, 401, 429] as const)('keeps uncertain %s charges reserved, partial evidence and no retry', async mode => {
  const f = await fixture(mode); const result = await f.service.execute(f.service.prepare('p').id);
  expect(result).toMatchObject({ state: 'unknown', accountedMicroCny: null, actualInputTokens: null, reservedMicroCny: 50000 });
  expect(f.calls).toHaveLength(1); expect(() => f.service.prepare('p')).toThrowError(expect.objectContaining({ code: 'invalid_state' }));
  if (mode === 'broken' || mode === 'usage-broken') expect(result.text).toBe('partial');
  if (mode === 'usage-broken') expect(result.observedUsage).toEqual({ inputTokens: 71, outputTokens: 8 });
  expect(JSON.stringify(result)).not.toContain('fake-controlled-secret');
});
it('does not cap or hide a provider usage overrun to make the client reservation appear absolute', async () => {
  const f = await fixture('overrun'); const r = await f.service.execute(f.service.prepare('p').id);
  expect(r.accountedMicroCny).toBe(100064); expect(r.accountedMicroCny).toBeGreaterThan(r.reservedMicroCny);
});
it('Abort preserves partial output and blocks concurrent/replayed requests', async () => {
  const f = await fixture('hang'); const q = f.service.prepare('p'); const p = f.service.execute(q.id);
  await vi.waitFor(() => expect(f.db.listControlledTrials()[0]?.text).toBe('partial'));
  await expect(f.service.execute(q.id)).rejects.toMatchObject({ code: 'forbidden' }); f.service.abort();
  expect(await p).toMatchObject({ state: 'unknown', outcome: 'cancelled', text: 'partial', errorCode: 'cancelled' }); expect(f.calls).toHaveLength(1);
});
it.each(['replace', 'revoke', 'endpoint', 'expired', 'quote-expired'] as const)('rejects %s after quotation before Key and transport', async change => {
  const f = await fixture(); const q = f.service.prepare('p');
  if (change === 'replace') await f.keys.storeKey('p', 'other-fake');
  if (change === 'revoke') await f.keys.deleteKey('p');
  if (change === 'endpoint') f.db.updateProvider({ id: 'p', name: 'Changed', kind: 'openai-compatible', baseUrl: 'https://elsewhere.example' });
  if (change === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deepSeekTrialReview.price.expiresAt));
  if (change === 'quote-expired') vi.spyOn(Date, 'now').mockReturnValue(Date.parse(q.expiresAt));
  await expect(f.service.execute(q.id)).rejects.toBeDefined(); expect(f.reads).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
});
it('keeps strict mode blocked before and after the separate authorized trial', async () => {
  const f = await fixture(); const request = { requestId: 'normal-run', modelId: 'deepseek-flash', messages: [{ role: 'user' as const, content: 'Reply OK.' }], outputTokenLimit: 128 };
  const normal = async () => { const events = []; for await (const e of f.registry.getAdapter('p').streamChat(request)) events.push(e); expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } }); };
  await normal(); expect(f.reads).not.toHaveBeenCalled(); await f.service.execute(f.service.prepare('p').id); await normal(); expect(f.calls).toHaveLength(1);
});
it('times out one HTTP request retaining unknown reservation and partial output', async () => {
  const f = await fixture('hang'); const r = await f.service.execute(f.service.prepare('p').id);
  expect(r).toMatchObject({ outcome: 'error', errorCode: 'timeout', text: 'partial', state: 'unknown', accountedMicroCny: null }); expect(f.calls).toHaveLength(1);
}, 25000);
