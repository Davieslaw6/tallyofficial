import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** Inline sql.js's WASM as base64 so the app never needs a runtime fetch (lets CSP say connect-src 'none'). */
function sqlWasm(): Plugin {
  const id = 'virtual:sqljs-wasm';
  return { name: 'sqljs-wasm', resolveId: (s) => (s === id ? '\0' + id : null), load: (s) => (s === '\0' + id ? `export default ${JSON.stringify(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm').toString('base64'))};` : null) };
}
/** Strict CSP is applied to production builds (dev server needs a websocket for HMR). */
function csp(): Plugin {
  const policy = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "manifest-src 'self'"].join('; ');
  return { name: 'csp', apply: 'build', transformIndexHtml: (html) => html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${policy}" />`) };
}
export default defineConfig({
  base: './', plugins: [react(), sqlWasm(), csp()],
  server: { proxy: { '/api': 'http://localhost:8787' } }, // `npm run dev:api` serves the cloud API locally
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
  worker: { format: 'es', plugins: () => [sqlWasm()] },
});
