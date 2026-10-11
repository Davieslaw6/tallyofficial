import { Db, createEmptyDb, loadDb, initEngine } from './db';
import { newSealedKey, deriveKey, seal, open, readHeader, VaultError, checkPassphrase, DEFAULT_KDF, type SealedKey, type KdfParams } from './crypto';
import { logEvent } from './audit';

export interface BlobStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, val: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
export class MemoryStore implements BlobStore {
  m = new Map<string, Uint8Array>();
  async get(k: string) { return this.m.get(k); }
  async put(k: string, v: Uint8Array) { this.m.set(k, v.slice()); }
  async del(k: string) { this.m.delete(k); }
  async keys() { return [...this.m.keys()]; }
}

export interface ProfileInfo { id: string; name: string; created: string; locked: boolean }
const META = 'meta/profiles';

async function readProfiles(store: BlobStore): Promise<ProfileInfo[]> {
  const b = await store.get(META); return b ? JSON.parse(new TextDecoder().decode(b)) : [];
}
async function writeProfiles(store: BlobStore, p: ProfileInfo[]) { await store.put(META, new TextEncoder().encode(JSON.stringify(p))); }

export class Session {
  private dirty = false; private rev = 0; private timer: ReturnType<typeof setTimeout> | null = null; private saving: Promise<void> = Promise.resolve();
  /** UI hook: called when a background save fails (e.g. storage full). The change stays queued and is retried. */
  onSaveError?: (e: unknown) => void;
  /** `sk` is null for a plain (unencrypted) local vault. */
  constructor(public id: string, public name: string, public db: Db, private sk: SealedKey | null, private store: BlobStore) {}

  /** Debounced encrypted write. Previous good copy is kept as `.prev` for corruption recovery. */
  touch(delay = 400) {
    this.dirty = true; this.rev++; if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch((e) => { this.onSaveError?.(e); this.touch(5000); }); }, delay);
  }
  /** Writes pending changes. Only marks them saved after the write succeeds; a failure leaves them queued and rejects. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.saving = this.saving.catch(() => {}).then(async () => {
      if (!this.dirty) return; const rev = this.rev; const snapshot = this.db.export();
      const blob = this.sk ? await seal(this.sk, snapshot) : snapshot;
      const cur = await this.store.get(`vault/${this.id}`);
      if (cur) await this.store.put(`vault/${this.id}.prev`, cur);
      await this.store.put(`vault/${this.id}`, blob);
      if (this.rev === rev) this.dirty = false;
    });
    return this.saving;
  }
  /** Saves first; if the save fails the vault stays open so nothing is lost. */
  async lock() { logEvent(this.db, 'vault.lock'); this.dirty = true; this.rev++; await this.flush(); this.db.close(); this.sk?.key.fill(0); }
  async exportArchive(): Promise<Uint8Array> { await this.flush(); const b = await this.store.get(`vault/${this.id}`); if (!b) throw new VaultError('not-found', 'Nothing saved yet'); return b; }
  /** Re-encrypt under a new passphrase with a fresh salt. */
  async changePassphrase(next: string, kdf: KdfParams = DEFAULT_KDF) {
    if (!this.sk) throw new VaultError('weak-passphrase', 'This vault has no passphrase');
    if (!checkPassphrase(next).ok && kdf.m >= DEFAULT_KDF.m) throw new VaultError('weak-passphrase', checkPassphrase(next).hint);
    this.sk!.key.fill(0); this.sk = await newSealedKey(next, kdf); this.dirty = true; await this.store.del(`vault/${this.id}.prev`); await this.flush();
    await this.store.del(`vault/${this.id}.prev`); // old snapshot is encrypted under the old passphrase — never keep it
  }
}

export class VaultManager {
  constructor(private store: BlobStore) {}
  list() { return readProfiles(this.store); }

  async create(name: string, passphrase: string, kdf: KdfParams = DEFAULT_KDF): Promise<Session> {
    const chk = checkPassphrase(passphrase);
    if (!chk.ok && kdf.m >= DEFAULT_KDF.m) throw new VaultError('weak-passphrase', chk.hint);
    const id = crypto.randomUUID(); const sk = await newSealedKey(passphrase, kdf); const db = await createEmptyDb();
    logEvent(db, 'vault.create', `profile=${name}`);
    const s = new Session(id, name, db, sk, this.store); s.touch(0); await s.flush();
    const all = await readProfiles(this.store); all.push({ id, name, created: new Date().toISOString(), locked: true }); await writeProfiles(this.store, all);
    return s;
  }

  async unlock(id: string, passphrase: string): Promise<Session> {
    const profiles = await readProfiles(this.store); const info = profiles.find((p) => p.id === id);
    if (!info) throw new VaultError('not-found', 'Profile not found');
    await initEngine();
    const main = await this.store.get(`vault/${id}`); if (!main) throw new VaultError('not-found', 'Vault file is missing');
    try { return await this.tryOpen(id, info.name, passphrase, main); }
    catch (e) {
      if (!(e instanceof VaultError)) throw e;
      // A truncated/corrupt file and a wrong passphrase look identical to AES-GCM. Fall back to the previous snapshot,
      // but only if it opens with the SAME passphrase — so a wrong passphrase still fails on both copies.
      const prev = await this.store.get(`vault/${id}.prev`); if (!prev) throw e;
      let s: Session; try { s = await this.tryOpen(id, info.name, passphrase, prev); } catch { throw e; }
      logEvent(s.db, 'restore', 'recovered from previous snapshot'); s.touch(0); return s;
    }
  }
  private async tryOpen(id: string, name: string, pass: string, blob: Uint8Array): Promise<Session> {
    const { kdf, salt } = readHeader(blob);
    const sk: SealedKey = { key: await deriveKey(pass, salt, kdf), salt, kdf };
    const bytes = await open(sk, blob);
    let db: Db; try { db = await loadDb(bytes); } catch { throw new VaultError('corrupt', 'Decrypted data is not a valid database'); }
    logEvent(db, 'vault.unlock'); const s = new Session(id, name, db, sk, this.store); s.touch(0); return s;
  }

  /** Opens (or creates on first run) the single plain local vault. No passphrase; data is stored unencrypted on this device. */
  async openPlain(name = 'Personal'): Promise<Session> {
    await initEngine(); const all = await readProfiles(this.store); let info = all[0];
    if (!info) {
      const id = crypto.randomUUID(); const db = await createEmptyDb(); const s = new Session(id, name, db, null, this.store); s.touch(0); await s.flush();
      all.push({ id, name, created: new Date().toISOString(), locked: false }); await writeProfiles(this.store, all); return s;
    }
    const load = async (key: string) => { const b = await this.store.get(key); if (!b) return null; if (b[0] === 0x54 && b[1] === 0x4c && b[2] === 0x59) throw new VaultError('corrupt', 'This browser holds an older passphrase-protected vault. Erase it from site data to start fresh.'); try { return await loadDb(b); } catch { return null; } };
    let db = await load(`vault/${info.id}`); let recovered = false;
    if (!db) { db = await load(`vault/${info.id}.prev`); recovered = !!db; }
    if (!db) throw new VaultError('corrupt', 'The saved data could not be read.');
    const s = new Session(info.id, info.name, db, null, this.store); if (recovered) { logEvent(db, 'restore', 'recovered from previous snapshot'); s.touch(0); } return s;
  }
  /** Replace a plain vault's contents with a backup file (validated as a real database first). */
  async restorePlain(id: string, bytes: Uint8Array) {
    const db = await loadDb(bytes); db.close(); const cur = await this.store.get(`vault/${id}`); if (cur) await this.store.put(`vault/${id}.prev`, cur); await this.store.put(`vault/${id}`, bytes);
  }
  async importArchive(name: string, archive: Uint8Array): Promise<string> {
    readHeader(archive); const id = crypto.randomUUID();
    await this.store.put(`vault/${id}`, archive);
    const all = await readProfiles(this.store); all.push({ id, name, created: new Date().toISOString(), locked: true }); await writeProfiles(this.store, all); return id;
  }
  /** Secure wipe: overwrite blobs with random bytes of equal length, then delete. */
  async wipe(id: string) {
    for (const k of [`vault/${id}`, `vault/${id}.prev`]) {
      const b = await this.store.get(k);
      if (b) { const junk = new Uint8Array(b.length); for (let o = 0; o < junk.length; o += 65536) crypto.getRandomValues(junk.subarray(o, Math.min(o + 65536, junk.length))); await this.store.put(k, junk); await this.store.del(k); }
    }
    await writeProfiles(this.store, (await readProfiles(this.store)).filter((p) => p.id !== id));
  }
}
