// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../../../src/main/providers/anthropic/AnthropicProvider';
import { configuration, input, fakeKey, start, blockStart, text, blockStop, delta, stop, success, frame, response, rawResponse, collect } from './fixtures';

const provider = (fetcher: typeof fetch) => new AnthropicProvider({ configuration, confirmedBaseUrl: 'https://api.anthropic.com', resolveKey: async () => fakeKey, fetch: fetcher });

describe('Anthropic stream protocol', () => {
  it.each(['\n', '\r', '\r\n'])('parses named SSE with %j lines, comments, empty text, unknown events and split UTF8', async newline => {
    const events = [start(), { type: 'ping' }, { type: 'future_event', secret: fakeKey }, blockStart(), text(''), text('汉字🙂'), blockStop(), delta(), stop()];
    const chunks = await collect(provider(async () => rawResponse(': comment' + newline + newline + events.map(value => frame(value, undefined, newline)).join(''), 1)).streamChat(input));
    expect(chunks.filter(e => e.type === 'text_delta').map(e => e.text).join('')).toBe('汉字🙂');
    expect(chunks.at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason: 'stop' });
    expect(JSON.stringify(chunks)).not.toContain(fakeKey);
  });

  it.each([['end_turn', 'stop'], ['stop_sequence', 'stop'], ['max_tokens', 'length'], ['model_context_window_exceeded', 'length'], ['refusal', 'content_filter']] as const)(
    'maps %s to %s', async (reason, normalized) => {
      const events = await collect(provider(async () => response([start(), delta(reason), stop()])).streamChat(input));
      expect(events.at(-1)).toEqual({ type: 'finish', requestId: input.requestId, reason: normalized });
    });

  it.each(['tool_use', 'pause_turn', 'unknown-finish'])('rejects unsupported stop reason %s without a finish', async reason => {
    const events = await collect(provider(async () => response([start(), delta(reason), stop()])).streamChat(input));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
    expect(events.some(e => e.type === 'finish')).toBe(false);
  });

  it('suppresses thinking, signature and redacted content while retaining visible text ordering', async () => {
    const events = [start(), blockStart(0, { type: 'thinking', thinking: 'private-thought', signature: 'private-signature' }),
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private-thought' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'private-signature' } }, blockStop(0),
      blockStart(1, { type: 'redacted_thinking', data: 'private-redacted' }), blockStop(1),
      blockStart(2), text('visible A', 2), blockStop(2), blockStart(3), text('visible B', 3), blockStop(3), delta(), stop()];
    const chunks = await collect(provider(async () => response(events)).streamChat(input));
    expect(chunks.filter(e => e.type === 'text_delta').map(e => e.text)).toEqual(['visible A', 'visible B']);
    expect(chunks.some(e => e.type === 'reasoning_summary_delta')).toBe(false);
    expect(JSON.stringify(chunks)).not.toMatch(/private-thought|private-signature|private-redacted/);
  });

  it.each(['tool_use', 'server_tool_use', 'future_block'])('rejects unsupported content block %s', async type => {
    const chunks = await collect(provider(async () => response([start(), blockStart(0, { type, id: 'tool', input: {} }), blockStop(), delta(), stop()])).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
  });

  it.each(['input_json_delta', 'citations_delta', 'future_delta'])('rejects unsupported delta %s', async type => {
    const chunks = await collect(provider(async () => response([start(), blockStart(), { type: 'content_block_delta', index: 0, delta: { type, partial_json: fakeKey } }])).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'unsupported' } });
    expect(JSON.stringify(chunks)).not.toContain(fakeKey);
  });

  it('combines uncached and cached input usage and emits only the final cumulative output total', async () => {
    const events = [start({ input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 11, cache_read_input_tokens: 13 }),
      blockStart(), text('one'), blockStop(), delta('end_turn', { input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens: 4 }), stop()];
    const chunks = await collect(provider(async () => response(events)).streamChat(input));
    expect(chunks.filter(e => e.type === 'usage')).toEqual([{ type: 'usage', requestId: input.requestId, inputTokens: 29, outputTokens: 4 }]);
  });

  it.each([
    [start({ output_tokens: 0 }), delta()], [start({ input_tokens: null, output_tokens: 0 }), delta()],
    [start({ input_tokens: 5, cache_read_input_tokens: null, output_tokens: 0 }), delta()],
    [start({ input_tokens: 5, output_tokens: 0 }), delta('end_turn', {})],
  ])('does not fabricate usage when a required counter is unknown (%j)', async (...events) => {
    const chunks = await collect(provider(async () => response([...events, stop()])).streamChat(input));
    expect(chunks.filter(e => e.type === 'usage')).toEqual([]);
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
  });

  it.each([-1, 1.25, Number.MAX_SAFE_INTEGER + 1, '12'])('rejects invalid token count %s', async input_tokens => {
    const chunks = await collect(provider(async () => response([start({ input_tokens, output_tokens: 0 }), delta(), stop()])).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(chunks.some(e => e.type === 'usage' || e.type === 'finish')).toBe(false);
  });

  it.each(['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'])('rejects a cumulative %s decrease including the message_start baseline', async field => {
    const initial = { input_tokens: 7, output_tokens: 2, cache_creation_input_tokens: 11, cache_read_input_tokens: 13 };
    const chunks = await collect(provider(async () => response([start(initial), delta('end_turn', { output_tokens: 3, [field]: 0 }), stop()])).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(chunks.some(e => e.type === 'usage' || e.type === 'finish')).toBe(false);
  });

  it('uses the final cumulative counters once rather than adding message deltas', async () => {
    const chunks = await collect(provider(async () => response([
      start({ input_tokens: 5, output_tokens: 1, cache_read_input_tokens: null }),
      { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 2, cache_read_input_tokens: 10 } },
      delta('end_turn', { input_tokens: 7, output_tokens: 4, cache_creation_input_tokens: 3, cache_read_input_tokens: null }), stop(),
    ])).streamChat(input));
    expect(chunks.filter(e => e.type === 'usage')).toEqual([{ type: 'usage', requestId: input.requestId, inputTokens: 20, outputTokens: 4 }]);
  });

  it('rejects input counter addition overflow', async () => {
    const chunks = await collect(provider(async () => response([start({ input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, output_tokens: 0 }), delta(), stop()])).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
  });

  it.each([
    ['no start', [delta(), stop()]], ['duplicate start', [start(), start(), delta(), stop()]],
    ['missing final reason', [start(), stop()]], ['truncated stream', [start(), blockStart(), text('partial')]],
    ['open content block at finish', [start(), blockStart(), delta(), stop()]],
    ['delta before content block', [start(), text('bad')]],
    ['wrong block index', [start(), blockStart(), text('bad', 7)]],
    ['duplicate block stop', [start(), blockStart(), blockStop(), blockStop()]],
    ['text after reason', [start(), delta(), blockStart(), text('late')]],
  ] as const)('rejects invalid stream ordering: %s', async (_name, events) => {
    const chunks = await collect(provider(async () => response([...events])).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
    expect(chunks.filter(e => e.type === 'error')).toHaveLength(1); expect(chunks.some(e => e.type === 'finish')).toBe(false);
  });

  it.each([
    frame(start(), 'content_block_start'), 'event: message_start\ndata: {invalid-json}\n\n',
    'event: message_start\ndata: {}\n\n', frame(start()) + 'event: ping\ndata: {"type":"ping"}',
    `event: ping\ndata: ${'x'.repeat(1024 * 1024)}\n\n`,
  ])('rejects malformed, mismatched, truncated or oversized SSE safely', async body => {
    const chunks = await collect(provider(async () => rawResponse(body)).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
  });

  it('rejects invalid UTF8 rather than replacing bytes', async () => {
    const chunks = await collect(provider(async () => rawResponse(new Uint8Array([0xc3, 0x28, 10, 10]))).streamChat(input));
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_response' } });
  });

  it.each(['bad id', 'x'.repeat(257)])('does not expose invalid provider request header %j', async id => {
    const chunks = await collect(provider(async () => response(success(), { headers: { 'request-id': id } })).streamChat(input));
    expect(chunks[0]).not.toHaveProperty('providerRequestId');
    expect(JSON.stringify(chunks)).not.toContain('vendor-message-id');
  });

  it.each([
    ['invalid_request_error', 'invalid_input'], ['authentication_error', 'authentication_failed'], ['permission_error', 'forbidden'],
    ['not_found_error', 'not_found'], ['rate_limit_error', 'rate_limited'], ['overloaded_error', 'internal_error'],
    ['api_error', 'internal_error'], ['unknown_private_type', 'internal_error'],
  ])('normalizes streamed %s after partial text without leaking the raw error', async (type, code) => {
    const chunks = await collect(provider(async () => response([start(), blockStart(), text('partial'),
      { type: 'error', error: { type, message: fakeKey, private: '/private/fixture' } },
    ])).streamChat(input));
    expect(chunks.filter(c => c.type === 'text_delta').map(c => c.text)).toEqual(['partial']);
    expect(chunks.at(-1)).toMatchObject({ type: 'error', error: { code } });
    expect(chunks.filter(c => c.type === 'error')).toHaveLength(1);
    expect(chunks.some(c => c.type === 'finish')).toBe(false);
    expect(JSON.stringify(chunks)).not.toMatch(/fixture-anthropic-secret|private/);
  });

  it('does not replace the Main request id with message.id when no request header exists', async () => {
    const chunks = await collect(provider(async () => response(success())).streamChat(input));
    expect(chunks[0]).toEqual({ type: 'start', requestId: input.requestId });
    expect(chunks.every(e => e.requestId === input.requestId)).toBe(true);
  });
});
