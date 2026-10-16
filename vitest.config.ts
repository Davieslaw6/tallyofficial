import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
const sqlWasm = { name: 'sqljs-wasm', resolveId: (s: string) => (s === 'virtual:sqljs-wasm' ? '\0w' : null), load: (s: string) => (s === '\0w' ? `export default ${JSON.stringify(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm').toString('base64'))};` : null) };
export default defineConfig({
  plugins: [sqlWasm],
  css: { },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'], testTimeout: 30000,
    coverage: { provider: 'v8', include: ['src/core/**'], reporter: ['text-summary', 'text'] } },
});
