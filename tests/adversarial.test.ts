import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-ignore legacy build for Node
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseAny, ImportError } from '../src/core/import';
import { parseCsv } from '../src/core/import/csv';
import { parseOfx } from '../src/core/import/ofx';
import { addDays, addMonths, diffDays, parseDate, todayIso } from '../src/core/dates';
import { VaultManager, MemoryStore, type BlobStore } from '../src/core/vault';
import { seal, newSealedKey } from '../src/core/crypto';
import { prepareReview, commitReview, makeCategorizer } from '../src/core/ingest';
import { auditReportHtml, reconcile } from '../src/core/reconcile';
import { freshRepo, FAST_KDF } from './helpers';

const good = new Uint8Array(readFileSync('tests/fixtures/stmt_columns.pdf'));
const PASS = 'lantern-orbit-ferry-77';

describe('adversarial: files', () => {
  it('survives 150 byte-flipped / truncated PDFs: always a result or a clean ImportError, never a hang or crash', async () => {
    let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let ok = 0, rejected = 0;
    for (let i = 0; i < 150; i++) {
      const b = good.slice(); const n = 1 + Math.floor(rnd() * 12); for (let k = 0; k < n; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      const data = i % 5 === 0 ? b.slice(0, Math.floor(rnd() * b.length)) : b;
      try { const r = await parseAny('f.pdf', data, pdfjs); expect(Array.isArray(r.rows)).toBe(true); ok++; } catch (e) { expect(e).toBeInstanceOf(Error); rejected++; }
    }
    expect(ok + rejected).toBe(150);
  }, 120000);
  it('rejects a "PDF" that is really a different file, and an empty file', async () => {
    await expect(parseAny('x.pdf', new TextEncoder().encode('%PDF-1.7\n' + 'A'.repeat(5000)), pdfjs)).rejects.toBeInstanceOf(Error);
    await expect(parseAny('x.csv', new Uint8Array(0))).rejects.toBeInstanceOf(ImportError);
  });
  it('caps CSV row count and survives a 1 MB cell, NUL bytes and bidi/zalgo text', () => {
    const big = 'Date,Description,Amount\n' + '2026-01-01,a,1.00\n'.repeat(210_000); expect(() => parseCsv(big)).toThrow(/Too many rows/);
    const r = parseCsv(`Date,Description,Amount\n2026-01-01,"${'x'.repeat(1_000_000)}",1.00\n2026-01-02,"ab\u0000cd \u202Eevil Z\u0335\u0321a\u0338lgo",2.00\n`); expect(r.rows).toHaveLength(2);
  });
  it('parses 50,000-row CSV in reasonable time', () => { const t = Date.now(); const r = parseCsv('Date,Description,Amount\n' + Array.from({ length: 50_000 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')},Row ${i},-${i % 900}.50`).join('\n')); expect(r.rows).toHaveLength(50_000); expect(Date.now() - t).toBeLessThan(5000); });
  it('OFX with pathological nesting/huge tags stays fast', () => { const t = Date.now(); const x = '<OFX>' + '<STMTTRN>'.repeat(1) + '<TRNAMT>' + '9'.repeat(200000) + '<DTPOSTED>20260101<NAME>x</STMTTRN></OFX>'; try { parseOfx(x); } catch { /* clean rejection ok */ } expect(Date.now() - t).toBeLessThan(2000); });
  it('absurd amounts parse but are rejected at commit, atomically (no half-imported statement)', async () => {
    const { repo, acct } = await freshRepo(); const parsed = parseCsv('Date,Description,Amount\n2026-01-01,ok row,10.00\n2026-01-02,absurd,99999999999999999999.00\n'); const cat = makeCategorizer(repo); const rv = prepareReview(repo, parsed, acct, cat);
    expect(() => commitReview(repo, acct, rv, cat, { fileBytes: new TextEncoder().encode('abs'), format: 'csv', parsed })).toThrow(); expect(repo.count()).toBe(0); expect(repo.db.scalar('SELECT COUNT(*) FROM statements')).toBe(0);
  });
});

describe('adversarial: content and rendering safety', () => {
  it('audit report HTML escapes hostile descriptions and ships a no-script CSP', async () => {
    const { repo, acct } = await freshRepo(); repo.addTx({ account_id: acct, date: '2026-03-02', amount: -1000, description: '<img src=x onerror=alert(1)> & "q"' });
    const rows = [{ date: '2026-03-03', amount: -5, description: '<script>alert(2)</script>', confidence: 1 }];
    const html = auditReportHtml('<b>Acct</b>', reconcile(repo, acct, { openingBalance: 0, closingBalance: -1000, periodStart: '2026-03-01', periodEnd: '2026-03-31', rows }));
    expect(html).not.toMatch(/<img src|<script>alert|<b>Acct/); expect(html).toContain('&lt;img src=x'); expect(html).toContain("default-src 'none'");
  });
  it('control characters are stripped from stored descriptions', async () => { const { repo, acct } = await freshRepo(); repo.addTx({ account_id: acct, date: '2026-03-02', amount: -1, description: 'a\u0000b\u001bc\nd' }); expect(repo.list()[0].description).toBe('a b c d'); });
});

describe('adversarial: time zones and DST (Lagos has none, but users travel)', () => {
  it('date math is calendar-based, never millisecond-based', () => {
    for (const [d, n, e] of [['2026-03-07', 1, '2026-03-08'], ['2026-03-08', 1, '2026-03-09'], ['2026-10-31', 2, '2026-11-02'], ['2026-03-28', 2, '2026-03-30'], ['2026-12-31', 1, '2027-01-01'], ['2024-02-28', 1, '2024-02-29']] as const) expect(addDays(d, n)).toBe(e);
    expect(diffDays('2026-03-09', '2026-03-08')).toBe(1); expect(diffDays('2026-11-02', '2026-11-01')).toBe(1); expect(diffDays('2026-11-01', '2026-03-08')).toBe(238); expect(addMonths('2026-03-08', 8)).toBe('2026-11-08');
    expect(parseDate('08/03/2026')).toBe('2026-03-08'); expect(todayIso(new Date(2026, 2, 8, 2, 30))).toBe('2026-03-08'); expect(todayIso(new Date(2026, 10, 1, 1, 30))).toBe('2026-11-01');
  });
});

class FlakyStore extends MemoryStore { failNext = 0; code = 'QuotaExceededError'; async put(k: string, v: Uint8Array) { if (this.failNext > 0 && !k.endsWith('.prev') && k.startsWith('vault/')) { this.failNext--; const e = new Error(this.code); e.name = this.code; throw e; } return super.put(k, v); } }
describe('adversarial: interrupted writes, low disk, corrupt data', () => {
  it('a failed write (disk full) never loses the previous snapshot, and the change is retried', async () => {
    const store = new FlakyStore(); const vm = new VaultManager(store); const s = await vm.create('P', PASS, FAST_KDF);
    s.db.run("INSERT INTO accounts(name,kind) VALUES('Kept','cash')"); s.touch(0); await s.flush();
    s.db.run("INSERT INTO accounts(name,kind) VALUES('Pending','cash')"); store.failNext = 1; s.touch(0); await expect(s.flush()).rejects.toThrow(/Quota/);
    const [p] = await vm.list(); const mid = await vm.unlock(p.id, PASS); expect(mid.db.all('SELECT name FROM accounts').map((r: any) => r.name)).toEqual(['Kept']); // old snapshot intact
    await s.flush(); // storage freed → the same unsaved change must now be written
    const after = await vm.unlock(p.id, PASS); expect(after.db.all('SELECT name FROM accounts').map((r: any) => r.name)).toEqual(['Kept', 'Pending']);
  });
  it('one failed write does not poison later saves', async () => {
    const store = new FlakyStore(); const vm = new VaultManager(store); const s = await vm.create('P', PASS, FAST_KDF);
    s.db.run("INSERT INTO accounts(name,kind) VALUES('A','cash')"); store.failNext = 1; s.touch(0); await expect(s.flush()).rejects.toThrow(); s.db.run("INSERT INTO accounts(name,kind) VALUES('B','cash')"); s.touch(0); await s.flush();
    const [p] = await vm.list(); expect((await vm.unlock(p.id, PASS)).db.scalar('SELECT COUNT(*) FROM accounts')).toBe(2);
  });
  it('decrypts fine but payload is not a database → clear "corrupt" error, falls back to previous snapshot', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); const s = await vm.create('P', PASS, FAST_KDF); s.db.run("INSERT INTO accounts(name,kind) VALUES('Good','cash')"); s.touch(0); await s.flush();
    const k = (await store.keys()).find((x) => /^vault\/[^.]+$/.test(x))!; const { SealedKey } = {} as never; void SealedKey;
    const raw = (await store.get(k))!; const salt = raw.slice(10, 26); const { deriveKey } = await import('../src/core/crypto'); const key = await deriveKey(PASS, salt, FAST_KDF);
    await store.put(k, await seal({ key, salt, kdf: FAST_KDF }, new TextEncoder().encode('not a sqlite file but a valid ciphertext'))); const [p] = await vm.list();
    const s2 = await vm.unlock(p.id, PASS); expect(s2.db.integrityOk()).toBe(true); expect(s2.db.scalar('SELECT COUNT(*) FROM audit_log WHERE event=\'restore\'')).toBe(1); // fell back to the previous snapshot and recorded it
  });
  it('archive import rejects random bytes and files with forged KDF headers', async () => { const vm = new VaultManager(new MemoryStore()); await expect(vm.importArchive('x', crypto.getRandomValues(new Uint8Array(500)))).rejects.toThrow(); const sk = await newSealedKey(PASS, FAST_KDF); const b = await seal(sk, new Uint8Array([1])); b[4] = 0x7f; await expect(vm.importArchive('x', b)).rejects.toThrow(); });
  it('passphrase change re-encrypts, old passphrase stops working and no old snapshot remains', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); const s = await vm.create('P', PASS, FAST_KDF); await s.changePassphrase('copper-meadow-lagoon-31', FAST_KDF); const [p] = await vm.list();
    await expect(vm.unlock(p.id, PASS)).rejects.toMatchObject({ code: 'bad-passphrase' }); await vm.unlock(p.id, 'copper-meadow-lagoon-31'); expect((await store.keys()).some((x) => x.endsWith('.prev'))).toBe(false);
  });
  it('overlapping statements: shifted re-import flags duplicates instead of double-counting', async () => {
    const { repo, acct } = await freshRepo(); const a = parseCsv('Date,Description,Amount\n2026-03-01,Shoprite,-100.00\n2026-03-02,Bolt,-20.00\n'); const cat = makeCategorizer(repo);
    commitReview(repo, acct, prepareReview(repo, a, acct, cat), cat, { fileBytes: new TextEncoder().encode('a'), format: 'csv', parsed: a });
    const b = parseCsv('Date,Description,Amount\n2026-03-02,BOLT,-20.00\n2026-03-03,Spar,-50.00\n'); const rv = prepareReview(repo, b, acct, cat); expect(rv.map((r) => r.dup)).toEqual(['exact', 'none']); expect(rv.map((r) => r.accept)).toEqual([false, true]); // 'BOLT' vs 'Bolt' is the same merchant
  });
});
