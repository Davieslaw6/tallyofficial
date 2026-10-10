import { argon2id } from 'hash-wasm';

export interface KdfParams { m: number; t: number; p: number } // m in KiB
/** OWASP-aligned interactive profile for a desktop/browser vault: 64 MiB, 3 passes. */
export const DEFAULT_KDF: KdfParams = { m: 65536, t: 3, p: 1 };
export const MIN_KDF: KdfParams = { m: 8192, t: 2, p: 1 };

const MAGIC = new Uint8Array([0x54, 0x4c, 0x59, 0x31]); // "TLY1"
const HEADER_LEN = 4 + 4 + 1 + 1 + 16 + 12; // magic + m + t + p + salt + iv

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(pass: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: pass.normalize('NFKC'), salt, parallelism: kdf.p, iterations: kdf.t,
    memorySize: kdf.m, hashLength: 32, outputType: 'binary',
  });
}
const importKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);

export interface SealedKey { key: Uint8Array; salt: Uint8Array; kdf: KdfParams }

export async function newSealedKey(pass: string, kdf: KdfParams = DEFAULT_KDF): Promise<SealedKey> {
  const salt = randomBytes(16);
  return { key: await deriveKey(pass, salt, kdf), salt, kdf };
}

function header(sk: SealedKey, iv: Uint8Array): Uint8Array {
  const h = new Uint8Array(HEADER_LEN); const dv = new DataView(h.buffer);
  h.set(MAGIC, 0); dv.setUint32(4, sk.kdf.m); h[8] = sk.kdf.t; h[9] = sk.kdf.p; h.set(sk.salt, 10); h.set(iv, 26);
  return h;
}

/** Encrypts with AES-256-GCM; the header (KDF params, salt, iv) is bound as AAD so tampering fails authentication. */
export async function seal(sk: SealedKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12); const h = header(sk, iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: h as BufferSource }, await importKey(sk.key), plain as BufferSource));
  const out = new Uint8Array(h.length + ct.length); out.set(h, 0); out.set(ct, h.length); return out;
}

export function readHeader(blob: Uint8Array): { kdf: KdfParams; salt: Uint8Array; iv: Uint8Array } {
  if (blob.length < HEADER_LEN + 16 || MAGIC.some((b, i) => blob[i] !== b)) throw new VaultError('corrupt', 'Not a Tally vault file');
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const kdf = { m: dv.getUint32(4), t: blob[8], p: blob[9] };
  if (kdf.m < MIN_KDF.m || kdf.m > 1 << 21 || kdf.t < MIN_KDF.t || kdf.t > 12 || kdf.p < 1 || kdf.p > 8) throw new VaultError('corrupt', 'Vault key settings are out of range');
  return { kdf, salt: blob.slice(10, 26), iv: blob.slice(26, 38) };
}

export async function open(sk: SealedKey, blob: Uint8Array): Promise<Uint8Array> {
  const { iv } = readHeader(blob);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: blob.slice(0, HEADER_LEN) as BufferSource }, await importKey(sk.key), blob.slice(HEADER_LEN) as BufferSource));
  } catch { throw new VaultError('bad-passphrase', 'Wrong passphrase, or the file was changed'); }
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const b = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class VaultError extends Error {
  constructor(public code: 'bad-passphrase' | 'corrupt' | 'weak-passphrase' | 'not-found', msg: string) { super(msg); }
}

export interface PassphraseCheck { ok: boolean; score: number; hint: string }
/** Length-first policy: 12+ chars and not trivially common/repetitive. */
export function checkPassphrase(p: string): PassphraseCheck {
  const COMMON = ['password', 'passphrase', '123456', 'qwerty', 'letmein', 'welcome', 'iloveyou', 'naija', 'lagos'];
  if (p.length < 12) return { ok: false, score: Math.min(1, p.length / 12), hint: `Use at least 12 characters (${12 - p.length} more)` };
  if (new Set(p.toLowerCase()).size < 5) return { ok: false, score: 1, hint: 'Too repetitive — mix in more different characters' };
  if (COMMON.some((c) => p.toLowerCase().includes(c))) return { ok: false, score: 1, hint: 'Contains a very common word — try a few unrelated words' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const score = Math.min(4, 1 + Math.floor(p.length / 8) + (classes > 2 ? 1 : 0));
  return { ok: true, score, hint: score >= 4 ? 'Strong' : 'Good — longer is stronger' };
}
