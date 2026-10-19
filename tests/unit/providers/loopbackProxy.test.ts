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
