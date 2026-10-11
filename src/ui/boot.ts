import wasmB64 from 'virtual:sqljs-wasm';
import { initEngine } from '../core/db';
import { VaultManager, type BlobStore } from '../core/vault';

export async function bootEngine() {
  const bin = Uint8Array.from(atob(wasmB64), (c) => c.charCodeAt(0));
  await initEngine(bin.buffer);
}

/** IndexedDB-backed blob store. Everything written here is already AES-GCM ciphertext, except the profile name list. */
export class IdbStore implements BlobStore {
  private dbp: Promise<IDBDatabase>;
  constructor(name = 'tally') {
    this.dbp = new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbp; return new Promise((res, rej) => { const t = db.transaction('blobs', mode); const r = f(t.objectStore('blobs')); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  async get(k: string) { const v = await this.tx<Uint8Array | undefined>('readonly', (s) => s.get(k)); return v ? new Uint8Array(v) : undefined; }
  async put(k: string, v: Uint8Array) { await this.tx('readwrite', (s) => s.put(v.slice(), k)); }
  async del(k: string) { await this.tx('readwrite', (s) => s.delete(k)); }
  async keys() { return (await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String); }
}
export const vaults = new VaultManager(new IdbStore());

export interface Prefs { theme: 'auto' | 'light' | 'dark' | 'contrast'; density: 'compact' | 'cozy' | 'roomy' }
const DEF: Prefs = { theme: 'auto', density: 'cozy' };
export const loadPrefs = (): Prefs => { try { return { ...DEF, ...JSON.parse(localStorage.getItem('tally.prefs') ?? '{}') }; } catch { return DEF; } };
export function applyPrefs(p: Prefs) {
  try { localStorage.setItem('tally.prefs', JSON.stringify(p)); } catch { /* storage may be blocked */ }
  const dark = p.theme === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : p.theme === 'dark';
  document.documentElement.dataset.theme = p.theme === 'contrast' ? 'contrast' : dark ? 'dark' : 'light'; document.documentElement.dataset.density = p.density;
}
export function download(name: string, data: Uint8Array | string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
