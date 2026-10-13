// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer, type UserConfig } from 'vite';
import electronConfig from '../../../electron.vite.config';

async function rendererConfig(): Promise<UserConfig> {
  const config: unknown = electronConfig;
  const resolved = typeof config === 'function'
    ? await config({ command: 'serve', mode: 'development' })
    : config;
  return (resolved as { renderer: UserConfig }).renderer;
}

function policy(html: string): string {
  const value = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  expect(value).toBeDefined();
  return value!;
}

describe('renderer development CSP', () => {
  it('authorizes injected Vite scripts by nonce and only the exact loopback HMR endpoint', async () => {
    const config = await rendererConfig();
    const server = await createServer({ ...config, configFile: false, root: resolve('src/renderer') });
    try {
      const source = await readFile(resolve('src/renderer/index.html'), 'utf8');
      const html = await server.transformIndexHtml('/', source);
      const csp = policy(html);
      const scriptPolicy = csp.match(/script-src ([^;]+);/)?.[1];
      const nonce = scriptPolicy?.match(/'nonce-([^']+)'/)?.[1];
      expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
      expect(scriptPolicy).not.toContain("'unsafe-inline'");
      expect(scriptPolicy).not.toContain("'unsafe-eval'");
      expect(csp).toContain("connect-src 'self' ws://127.0.0.1:5173;");
      expect(csp).not.toContain('localhost:*');
      expect(csp).toContain("frame-src 'none';");
      expect(csp).toContain("object-src 'none';");
      expect(csp).toContain("base-uri 'none';");
      expect(html).toContain('/@vite/client');
      expect(html).toContain('/@react-refresh');
      const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
      expect(scripts.length).toBeGreaterThanOrEqual(3);
      for (const [, attributes] of scripts) expect(attributes).toContain(`nonce="${nonce}"`);
    } finally {
      await server.close();
    }
  });
});
