// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ContractError } from '../../../../src/shared/contracts/errors';
import { readSse } from '../../../../src/main/providers/compatible/sse';

const encoder = new TextEncoder();
const headers = { 'content-type': 'text/event-stream; charset=utf-8' };

function response(chunks: Uint8Array[], contentType = headers['content-type']): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }), { headers: { 'content-type': contentType } });
}

async function collect(value: Response, signal = new AbortController().signal): Promise<string[]> {
  const data: string[] = [];
  for await (const item of readSse(value, signal)) data.push(item);
  return data;
}

describe('readSse', () => {
  it('preserves Unicode and multiline data across every byte split and CRLF boundary', async () => {
    const bytes = encoder.encode(': heartbeat\r\nevent: message\r\nid: ignored\r\nretry: 5\r\ndata: 你🙂\r\ndata: next\r\n\r\ndata:[DONE]\r\n\r\n');
    for (let split = 0; split <= bytes.length; split += 1) {
      expect(await collect(response([bytes.slice(0, split), bytes.slice(split)]))).toEqual(['你🙂\nnext', '[DONE]']);
    }
    expect(await collect(response(Array.from(bytes, byte => Uint8Array.of(byte))))).toEqual(['你🙂\nnext', '[DONE]']);
  });

  it('supports LF, bare CR, empty data, default events, and an initial UTF-8 BOM', async () => {
    expect(await collect(response([encoder.encode('\ufeffdata: one\n\ndata:\r\revent:\ndata:  two\n\n')]))).toEqual(['one', '', ' two']);
  });

  it('ignores comments and fields without data while allowing ordinary framed EOF', async () => {
    expect(await collect(response([encoder.encode(': comment\n\nid: 4\nretry: 2\nevent: message\nunknown: ignored\n\ndata: final\n\n')]))).toEqual(['final']);
  });

  it.each(['application/json', 'text/plain', 'text/event-streaming'])('rejects a non-SSE content type %s', async contentType => {
    await expect(collect(response([encoder.encode('data: secret\n\n')], contentType))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('requires a response body and accepts case-insensitive SSE media types', async () => {
    await expect(collect(new Response(null, { headers }))).rejects.toMatchObject({ code: 'invalid_response' });
    expect(await collect(response([encoder.encode('data: ok\n\n')], 'Text/Event-Stream; charset=UTF-8'))).toEqual(['ok']);
  });

  it.each(['data: unframed', 'data: unframed\n', 'event: message\n'])('rejects an unfinished frame %j', async text => {
    await expect(collect(response([encoder.encode(text)]))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each(['error', 'custom'])('rejects an unsupported event type %s without returning its text', async type => {
    await expect(collect(response([encoder.encode(`event: ${type}\ndata: secret\n\n`)]))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([Uint8Array.of(0xc3, 0x28), Uint8Array.of(0xf0, 0x9f)])('rejects invalid or incomplete UTF-8', async bytes => {
    await expect(collect(response([encoder.encode('data: '), bytes, encoder.encode('\n\n')]))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('bounds a single line before exposing an oversized event', async () => {
    await expect(collect(response([encoder.encode(`data: ${'a'.repeat(1024 * 1024 + 1)}\n\n`)]))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('bounds an event made of many individually small lines', async () => {
    await expect(collect(response([encoder.encode(`${`data: ${'a'.repeat(64 * 1024)}\n`.repeat(17)}\n`)]))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('cancels and unlocks the body when its consumer returns early', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('data: first\n\ndata: second\n\n')); },
      cancel() { cancelled = true; },
    });
    const iterator = readSse(new Response(body, { headers }), new AbortController().signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: 'first' });
    await iterator.return?.();
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('does not yield remaining buffered events after its consumer aborts', async () => {
    const controller = new AbortController();
    const iterator = readSse(response([encoder.encode('data: first\n\ndata: late\n\n')]), controller.signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: 'first' });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('interrupts a blocked read even if transport cancellation never settles', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = collect(new Response(body, { headers }), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
    expect(remove.mock.calls).toHaveLength(add.mock.calls.length);
  });

  it('rejects an already-aborted signal and cancels its body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const controller = new AbortController();
    controller.abort();
    await expect(collect(new Response(body, { headers }), controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('keeps yielded partial data and sanitizes a subsequent transport failure', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; controller.enqueue(encoder.encode('data: partial\n\n')); } });
    const iterator = readSse(new Response(body, { headers }), new AbortController().signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: 'partial' });
    streamController.error(new Error('secret-key /private/example'));
    const error = await iterator.next().catch(value => value);
    expect(error).toBeInstanceOf(ContractError);
    expect(error).toMatchObject({ code: 'network_error' });
    expect(String(error.stack)).not.toMatch(/secret-key|private\/example/);
    expect(body.locked).toBe(false);
  });

  it('cancels and unlocks its reader after a protocol failure', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('event: error\ndata: secret\n\n')); },
      cancel() { cancelled = true; },
    });
    await expect(collect(new Response(body, { headers }))).rejects.toMatchObject({ code: 'invalid_response' });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
