import type { ParsedStatement } from '../core/import/types';
import { LIMITS } from '../core/import/types';

export function parseInWorker(name: string, data: ArrayBuffer): Promise<ParsedStatement> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/import.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('Reading this file took too long and was stopped. Try a smaller file or export a CSV from your bank.')); }, LIMITS.timeMs + 5000);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); e.data.ok ? resolve(e.data.res) : reject(new Error(e.data.error)); };
    w.onerror = () => { clearTimeout(timer); w.terminate(); reject(new Error('The file reader crashed. The file may be damaged.')); };
    w.postMessage({ name, data }, [data]);
  });
}
