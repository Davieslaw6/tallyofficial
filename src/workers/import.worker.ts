/// <reference lib="webworker" />
// Parsing runs here, away from the UI thread, so a hostile or huge file can be terminated on timeout.
// No network APIs are used in this file; the PDF engine is bundled and runs as an in-thread "fake worker".
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import 'pdfjs-dist/build/pdf.worker.mjs';
import { parseAny } from '../core/import';

// Defence in depth: workers do not inherit the page's meta CSP, so cut off every network primitive explicitly.
const deny = () => { throw new Error('Network access is disabled in the import worker'); };
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'WebTransport'] as const) { try { Object.defineProperty(self, k, { value: deny, configurable: false, writable: false }); } catch { /* already locked */ } }

self.onmessage = async (e: MessageEvent<{ name: string; data: ArrayBuffer }>) => {
  try { const res = await parseAny(e.data.name, new Uint8Array(e.data.data), pdfjs); (self as unknown as Worker).postMessage({ tally: true, ok: true, res }); }
  catch (err: any) { (self as unknown as Worker).postMessage({ tally: true, ok: false, error: err?.message ?? 'Could not read this file' }); }
};
