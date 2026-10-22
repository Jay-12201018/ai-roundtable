// @vitest-environment node
import { expect, it } from 'vitest';
import { readLoopbackProxy, assertProxyTarget } from '../../../src/main/providers/loopbackProxy';

it('defaults to direct and accepts only explicitly trusted canonical loopback HTTP proxies', () => {
  expect(readLoopbackProxy({})).toBeUndefined();
  expect(readLoopbackProxy({ ROUNDTABLE_CONNECT_PROXY: 'http://127.0.0.1:7890', ROUNDTABLE_TRUST_PROXY_DNS: '1' })).toEqual({ hostname: '127.0.0.1', port: 7890 });
  expect(readLoopbackProxy({ ROUNDTABLE_CONNECT_PROXY: 'http://[::1]:1234', ROUNDTABLE_TRUST_PROXY_DNS: '1' })).toEqual({ hostname: '::1', port: 1234 });
});
it.each(['http://localhost:7890', 'socks5://127.0.0.1:7890', 'https://127.0.0.1:7890', 'http://127.1:7890',
  'http://2130706433:7890', 'http://127.0.0.2:7890', 'http://8.8.8.8:7890', 'http://user:secret@127.0.0.1:7890',
  'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:07890', 'http://127.0.0.1:7890/path',
  'http://127.0.0.1:7890?x=1', 'http://127.0.0.1:7890#x', ' http://127.0.0.1:7890', 'http://[::ffff:127.0.0.1]:7890'])('rejects ambiguous/remote/credentialled proxy %s', url => {
  expect(() => readLoopbackProxy({ ROUNDTABLE_CONNECT_PROXY: url, ROUNDTABLE_TRUST_PROXY_DNS: '1' })).toThrow();
});
it('requires explicit remote DNS trust and rejects incomplete configuration', () => {
  expect(() => readLoopbackProxy({ ROUNDTABLE_CONNECT_PROXY: 'http://127.0.0.1:7890' })).toThrow();
  expect(() => readLoopbackProxy({ ROUNDTABLE_TRUST_PROXY_DNS: '1' })).toThrow();
});
it('only permits the reviewed exact HTTPS origin/path for proxy transport', () => {
  expect(() => assertProxyTarget(new URL('https://api.deepseek.com/chat/completions'), 'POST')).not.toThrow();
  for (const url of ['http://api.deepseek.com/chat/completions', 'https://api.deepseek.com:444/chat/completions',
    'https://other.example/chat/completions', 'https://api.deepseek.com/models', 'https://api.deepseek.com/chat/completions?x=1',
    'https://api.deepseek.com/chat/completions#x', 'https://user@api.deepseek.com/chat/completions', 'https://198.18.0.12/chat/completions']) {
    expect(() => assertProxyTarget(new URL(url), 'POST')).toThrow();
  }
  expect(() => assertProxyTarget(new URL('https://api.deepseek.com/chat/completions'), 'GET')).toThrow();
});
it('checks each reviewed Provider kind against its own fixed host and request shapes', () => {
  const allowed: Array<[string, string, 'deepseek' | 'anthropic' | 'gemini']> = [
    ['https://api.anthropic.com/v1/messages', 'POST', 'anthropic'],
    ['https://api.anthropic.com/v1/models?limit=1000', 'GET', 'anthropic'],
    ['https://api.anthropic.com/v1/models?limit=1000&after_id=abc', 'GET', 'anthropic'],
    ['https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse', 'POST', 'gemini'],
    ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&pageToken=t', 'GET', 'gemini'],
  ];
  for (const [url, method, kind] of allowed) expect(() => assertProxyTarget(new URL(url), method, kind)).not.toThrow();
  const refused: Array<[string, string, 'deepseek' | 'anthropic' | 'gemini']> = [
    // The old DeepSeek-only check refused every native origin; the DeepSeek path is still not valid for them.
    ['https://api.anthropic.com/chat/completions', 'POST', 'anthropic'],
    ['https://api.deepseek.com/chat/completions', 'POST', 'anthropic'],
    ['https://api.anthropic.com/v1/messages', 'POST', 'gemini'],
    ['https://api.anthropic.com/v1/messages?x=1', 'POST', 'anthropic'],
    ['https://api.anthropic.com/v1/messages#x', 'POST', 'anthropic'],
    ['https://api.anthropic.com:444/v1/messages', 'POST', 'anthropic'],
    ['https://api.anthropic.com/v1/models', 'GET', 'anthropic'],
    ['https://api.anthropic.com/v1/models?limit=1000&limit=1000', 'GET', 'anthropic'],
    ['https://api.anthropic.com/v1/messages', 'GET', 'anthropic'],
    ['https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent', 'POST', 'gemini'],
    ['https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse&key=k', 'POST', 'gemini'],
    ['https://generativelanguage.googleapis.com/v1/models?pageSize=100', 'GET', 'gemini'],
    ['http://generativelanguage.googleapis.com/v1beta/models?pageSize=100', 'GET', 'gemini'],
    ['https://user@api.anthropic.com/v1/messages', 'POST', 'anthropic'],
    ['https://api.deepseek.com/v1/messages', 'POST', 'deepseek'],
  ];
  for (const [url, method, kind] of refused) expect(() => assertProxyTarget(new URL(url), method, kind)).toThrow();
});
