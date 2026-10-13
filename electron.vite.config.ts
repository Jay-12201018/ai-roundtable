import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(16).toString('base64') : undefined;
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
    },
    preload: {
      build: {
        rollupOptions: {
          output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
        },
      },
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer'),
          '@shared': resolve('src/shared'),
        },
      },
      server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        hmr: { protocol: 'ws', host: '127.0.0.1', port: 5173 },
      },
      html: nonce ? { cspNonce: nonce } : undefined,
      plugins: [react(), {
        name: 'roundtable-development-csp',
        apply: 'serve',
        transformIndexHtml: {
          order: 'post',
          handler: (html) => html
            .replace("script-src 'self';", `script-src 'self' 'nonce-${nonce}';`)
            .replace("connect-src 'none';", "connect-src 'self' ws://127.0.0.1:5173;"),
        },
      }],
    },
  };
});
