// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createNativeSafeFetch } from '../../../src/main/providers/network';

const definitions = [
  { kind: 'anthropic', url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': 'owned-fake', 'anthropic-version': '2023-06-01' },
    body: { model: 'fixture', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, stream: true } },
  { kind: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/fixture:streamGenerateContent?alt=sse', headers: { 'x-goog-api-key': 'owned-fake' },
    body: { contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }], generationConfig: { candidateCount: 1, maxOutputTokens: 8 } } },
] as const;

describe.each(definitions)('$kind native transport boundary', d => {
  const parameters = () => ({ method: 'POST', headers: d.headers, body: JSON.stringify(d.body), redirect: 'error' as const });
  it('passes only the reviewed native request to the existing restricted transport', async () => {
    const sent = vi.fn<typeof fetch>(async () => new Response('fixture'));
    const guard = vi.fn();
    expect(await (await createNativeSafeFetch(d.kind, sent, guard)(d.url, parameters())).text()).toBe('fixture');
    expect(sent).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalled();
  });
  it.each(['https://unreviewed.invalid', 'http://127.0.0.1:7890', 'https://api.deepseek.com'])('rejects a different origin %s before transport', async origin => {
    const sent = vi.fn<typeof fetch>(); const url = new URL(d.url); const other = new URL(origin);
    url.protocol = other.protocol; url.host = other.host;
    await expect(createNativeSafeFetch(d.kind, sent)(url, parameters())).rejects.toMatchObject({ code: 'forbidden' });
    expect(sent).not.toHaveBeenCalled();
  });
  it.each(['path', 'query', 'method', 'redirect', 'extra-body', 'authorization', 'missing-key'])('rejects %s changes before transport', async change => {
    const sent = vi.fn<typeof fetch>(); const url = new URL(d.url); const init: RequestInit = parameters();
    if (change === 'path') url.pathname = '/unreviewed';
    if (change === 'query') url.searchParams.set('key', 'unreviewed');
    if (change === 'method') init.method = 'PUT';
    if (change === 'redirect') init.redirect = 'follow';
    if (change === 'extra-body') init.body = JSON.stringify({ ...d.body, tools: [] });
    if (change === 'authorization') init.headers = { ...d.headers, Authorization: 'Bearer must-not-pass' };
    if (change === 'missing-key') init.headers = {};
    await expect(createNativeSafeFetch(d.kind, sent)(url, init)).rejects.toMatchObject({ code: 'forbidden' });
    expect(sent).not.toHaveBeenCalled();
  });
  it('cancels a late response when target or Key revision has been revoked', async () => {
    let trusted = true; const cancel = vi.fn();
    const sent: typeof fetch = async () => { trusted = false; return new Response(new ReadableStream({ cancel })); };
    await expect(createNativeSafeFetch(d.kind, sent, () => { if (!trusted) throw new Error('revoked'); })(d.url, parameters())).rejects.toThrow('revoked');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
