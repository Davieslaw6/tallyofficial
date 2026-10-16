import { readFileSync } from 'node:fs';
import { initEngine } from '../src/core/db';
const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm');
await initEngine(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
