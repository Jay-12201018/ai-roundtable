// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatibleProvider } from '../../../../src/main/providers/compatible/CompatibleProvider';
import { configuration, input, collect, sse, chunk } from './fixtures';

afterEach(() => vi.restoreAllMocks());

it('enforces the total deadline while ready SSE heartbeats yield no model data', async () => {
  let now = 0;
  let pulls = 0;
  let cancelled = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const heartbeat = new TextEncoder().encode(': heartbeat\n\n');
  const provider = new CompatibleProvider({
    configuration, confirmedBaseUrl: 'https://service.example/v1',
    resolveKey: async () => 'fixture-deadline-key', timeoutMs: 100,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        now += 10;
        if (++pulls === 100) controller.close();
        else controller.enqueue(heartbeat);
      },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } }),
  });

  const events = await collect(provider.streamChat(input));

  expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
  expect(events.filter(event => event.type === 'finish')).toEqual([]);
  expect(pulls).toBeLessThan(100);
  expect(cancelled).toBe(true);
});

describe('D135 a generation stream has its own total', () => {
  it('lets a slow stream run past the list timeout when a longer stream timeout is given', async () => {
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5, streamTimeoutMs: 5000,
      fetch: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return sse(chunk('好'), chunk(null, 'stop'), '[DONE]'); } });
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });
  });
  it('still stops at the stream timeout', async () => {
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5000, streamTimeoutMs: 5,
      fetch: async (_url, init) => new Promise((_, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)); }) });
    expect((await collect(provider.streamChat(input))).at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
  });
});

describe('D164 a reply that goes silent is cut off, and one that keeps arriving is not', () => {
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`);
  const word = (text: string) => line({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  it('some words, then nothing: it ends as a timeout after the idle limit, with the words it had', async () => {
    let cancelled = false;
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5000, streamTimeoutMs: 5000, streamIdleTimeoutMs: 40,
      fetch: async (_url, init) => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(word('说到一半')); init!.signal!.addEventListener('abort', () => { try { controller.error(init!.signal!.reason); } catch { /* closed */ } }); },
        cancel() { cancelled = true; },
      }), { headers: { 'content-type': 'text/event-stream' } }) });
    const started = Date.now();
    const events = await collect(provider.streamChat(input));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(events.filter(event => event.type === 'text_delta')).toMatchObject([{ text: '说到一半' }]);
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'timeout' } });
  });
  it('words and heartbeats that keep coming, each within the limit, run to the end however long the whole takes', async () => {
    const parts = [word('一'), encoder.encode(': keep-alive\n\n'), encoder.encode(': keep-alive\n\n'), word('二'), encoder.encode(': keep-alive\n\n'), line({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }), line('[DONE]')];
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5000, streamTimeoutMs: 5000, streamIdleTimeoutMs: 60,
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        async pull(controller) { await new Promise(resolve => setTimeout(resolve, 25)); const next = parts.shift(); if (next) controller.enqueue(next); else controller.close(); },
      }), { headers: { 'content-type': 'text/event-stream' } }) });
    const events = await collect(provider.streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });
    expect(events.filter(event => event.type === 'text_delta').map(event => (event as { text: string }).text).join('')).toBe('一二');
  });
  it('without the limit, nothing changes', async () => {
    const provider = new CompatibleProvider({ configuration, confirmedBaseUrl: 'https://service.example/v1', resolveKey: async () => 'owned-fake-key', timeoutMs: 5000,
      fetch: async () => { await new Promise(resolve => setTimeout(resolve, 60)); return sse(chunk('好'), chunk(null, 'stop'), '[DONE]'); } });
    expect((await collect(provider.streamChat(input))).at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });
  });
});
