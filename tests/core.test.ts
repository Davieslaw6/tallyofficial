import { describe, it, expect } from 'vitest';
import { parseAmount, formatMoney, allocate } from '../src/core/money';
import { parseDate, addMonths, validIso, diffDays, addDays } from '../src/core/dates';
import { seal, open, newSealedKey, checkPassphrase, readHeader, VaultError } from '../src/core/crypto';
import { VaultManager, MemoryStore } from '../src/core/vault';
import { verifyChain, logEvent } from '../src/core/audit';
import { sha256Sync } from '../src/core/sha256';
import { createEmptyDb, loadDb } from '../src/core/db';
import { RepoError } from '../src/core/repo';
import { freshRepo, FAST_KDF } from './helpers';

describe('money', () => {
  it('parses naira formats', () => {
    expect(parseAmount('₦1,234.50')).toBe(123450); expect(parseAmount('(500.00)')).toBe(-50000); expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('2,500.00 DR')).toBe(-250000); expect(parseAmount('-0.99')).toBe(-99); expect(parseAmount('abc')).toBeNull(); expect(parseAmount('')).toBeNull();
  });
  it('formats with a true minus sign', () => { expect(formatMoney(-123456)).toBe('\u2212\u20A61,234.56'); expect(formatMoney(5, { sign: true })).toBe('+\u20A60.05'); });
  it('allocates exactly', () => { expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100); expect(allocate(-1001, [3, 3, 4]).reduce((a, b) => a + b)).toBe(-1001); });
});
describe('dates', () => {
  it('parses common bank formats', () => {
    expect(parseDate('05/03/2026')).toBe('2026-03-05'); expect(parseDate('5 Mar 2026')).toBe('2026-03-05'); expect(parseDate('2026-03-05')).toBe('2026-03-05');
    expect(parseDate('20260305120000')).toBe('2026-03-05'); expect(parseDate('Mar 5, 2026')).toBe('2026-03-05'); expect(parseDate('31/02/2026')).toBeNull();
  });
  it('month math clamps and is DST-proof', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(diffDays('2026-03-30', '2026-03-29')).toBe(1); expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); expect(validIso('2026-02-30')).toBe(false);
  });
});
describe('crypto', () => {
  it('round-trips and rejects wrong key / tampering', async () => {
    const sk = await newSealedKey('correct horse battery', FAST_KDF); const blob = await seal(sk, new TextEncoder().encode('secret ledger'));
    expect(new TextDecoder().decode(await open(sk, blob))).toBe('secret ledger');
    const bad = await newSealedKey('wrong horse battery!', FAST_KDF); await expect(open({ ...bad, salt: sk.salt, kdf: sk.kdf }, blob)).rejects.toThrow(/Wrong passphrase/);
    const t = blob.slice(); t[12] ^= 1; await expect(open(sk, t)).rejects.toBeInstanceOf(VaultError); // header tamper detected via AAD
    const t2 = blob.slice(); t2[t2.length - 1] ^= 1; await expect(open(sk, t2)).rejects.toBeInstanceOf(VaultError);
  });
  it('ciphertext does not contain plaintext', async () => {
    const sk = await newSealedKey('correct horse battery', FAST_KDF); const blob = await seal(sk, new TextEncoder().encode('SHOPRITE 12,500.00 '.repeat(50)));
    expect(new TextDecoder('latin1').decode(blob)).not.toContain('SHOPRITE');
  });
  it('rejects absurd KDF params from a hostile file', () => {
    const b = new Uint8Array(80); b.set([0x54, 0x4c, 0x59, 0x31]); new DataView(b.buffer).setUint32(4, 0xffffffff); expect(() => readHeader(b)).toThrow();
  });
  it('enforces passphrase policy', () => { expect(checkPassphrase('short').ok).toBe(false); expect(checkPassphrase('aaaaaaaaaaaaaa').ok).toBe(false); expect(checkPassphrase('password12345').ok).toBe(false); expect(checkPassphrase('lantern-orbit-ferry-77').ok).toBe(true); });
  it('sha256 matches known vectors', () => { expect(sha256Sync('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); expect(sha256Sync('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); });
});
describe('vault', () => {
  it('create → lock → unlock keeps data; wrong passphrase fails without recovery', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); const s = await vm.create('Personal', 'lantern-orbit-ferry-77', FAST_KDF);
    s.db.run("INSERT INTO accounts(name,kind) VALUES('Cash','cash')"); s.touch(0); await s.lock();
    const [p] = await vm.list(); await expect(vm.unlock(p.id, 'not the right one!!')).rejects.toMatchObject({ code: 'bad-passphrase' });
    const s2 = await vm.unlock(p.id, 'lantern-orbit-ferry-77'); expect(s2.db.scalar<string>('SELECT name FROM accounts')).toBe('Cash'); expect(verifyChain(s2.db).ok).toBe(true);
  });
  it('vault bytes on disk are not a readable SQLite file', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); await vm.create('P', 'lantern-orbit-ferry-77', FAST_KDF);
    const [k] = (await store.keys()).filter((k) => k.startsWith('vault/') && !k.endsWith('.prev')); const raw = (await store.get(k))!;
    expect(new TextDecoder('latin1').decode(raw)).not.toContain('SQLite format 3');
  });
  it('recovers from a corrupted main file using the previous snapshot', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); const s = await vm.create('P', 'lantern-orbit-ferry-77', FAST_KDF);
    s.touch(0); await s.flush(); s.db.run("INSERT INTO accounts(name,kind) VALUES('A','cash')"); s.touch(0); await s.flush();
    const k = (await store.keys()).find((x) => /^vault\/[^.]+$/.test(x))!; const good = (await store.get(k))!; const bad = good.slice(0, 60); await store.put(k, bad);
    const [p] = await vm.list(); const s2 = await vm.unlock(p.id, 'lantern-orbit-ferry-77'); expect(s2.db.integrityOk()).toBe(true);
  });
  it('wipe removes the vault and profile entry', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); await vm.create('P', 'lantern-orbit-ferry-77', FAST_KDF); const [p] = await vm.list(); await vm.wipe(p.id);
    expect(await vm.list()).toHaveLength(0); expect((await store.keys()).filter((k) => k.startsWith('vault/'))).toHaveLength(0);
  });
  it('profiles are isolated: one passphrase cannot open the other', async () => {
    const vm = new VaultManager(new MemoryStore()); await vm.create('Personal', 'lantern-orbit-ferry-77', FAST_KDF); await vm.create('Business', 'copper-meadow-lagoon-31', FAST_KDF);
    const [a, b] = await vm.list(); await expect(vm.unlock(a.id, 'copper-meadow-lagoon-31')).rejects.toBeInstanceOf(VaultError); await expect(vm.unlock(b.id, 'lantern-orbit-ferry-77')).rejects.toBeInstanceOf(VaultError);
  });
  it('rejects weak passphrases at creation', async () => { await expect(new VaultManager(new MemoryStore()).create('P', 'short')).rejects.toMatchObject({ code: 'weak-passphrase' }); });
});
describe('audit log', () => {
  it('is hash-chained, append-only (SQL triggers) and detects tampering', async () => {
    const db = await createEmptyDb(); logEvent(db, 'import', 'a'); logEvent(db, 'export', 'b'); expect(verifyChain(db).ok).toBe(true);
    expect(() => db.run("UPDATE audit_log SET detail='x' WHERE id=1")).toThrow(/append-only/); expect(() => db.run('DELETE FROM audit_log')).toThrow(/append-only/);
    // simulate offline tamper by dropping trigger
    db.raw.run('DROP TRIGGER audit_no_update'); db.run("UPDATE audit_log SET detail='forged' WHERE id=2"); expect(verifyChain(db).ok).toBe(false);
  });
});
describe('database', () => {
  it('migrations are idempotent and reload from bytes', async () => {
    const db = await createEmptyDb(); const bytes = db.export(); const db2 = await loadDb(bytes); expect(db2.scalar('SELECT COUNT(*) FROM schema_migrations')).toBe(2);
  });
  it('rejects a non-database payload', async () => { await expect(loadDb(new TextEncoder().encode('this is not sqlite at all, just text'))).rejects.toThrow(); });
});
describe('repo: transactions, splits, transfers', () => {
  it('validates input', async () => {
    const { repo, acct } = await freshRepo();
    expect(() => repo.addTx({ account_id: acct, date: '2026-02-30', amount: 100, description: 'x' })).toThrow(RepoError);
    expect(() => repo.addTx({ account_id: acct, date: '2026-02-01', amount: 1.5, description: 'x' })).toThrow(/whole number/);
    expect(() => repo.addTx({ account_id: 999, date: '2026-02-01', amount: 100, description: 'x' })).toThrow(/Unknown account/);
    expect(() => repo.addTx({ account_id: acct, date: '2026-02-01', amount: 100, description: '   ' })).toThrow(/required/);
  });
  it('stores unicode and hostile text safely (parameterised SQL)', async () => {
    const { repo, acct } = await freshRepo(); const evil = "Robert'); DROP TABLE transactions;-- ₦ 日本語 🚀 <script>alert(1)</script>";
    const id = repo.addTx({ account_id: acct, date: '2026-02-01', amount: -100, description: evil }); expect(repo.list()[0].description).toContain('DROP TABLE'); expect(repo.count()).toBe(1); expect(id).toBeGreaterThan(0);
    expect(repo.list({ q: '100%_' })).toHaveLength(0); // LIKE wildcards are escaped
  });
  it('split validation: remainder must be zero and directions must agree', async () => {
    const { repo, acct } = await freshRepo(); const id = repo.addTx({ account_id: acct, date: '2026-02-01', amount: -10000, description: 'Shoprite' });
    const g = repo.categoryId('Groceries'), h = repo.categoryId('Health');
    expect(() => repo.setSplits(id, [{ category_id: g, amount: -6000 }, { category_id: h, amount: -3000 }])).toThrow(/left to assign/);
    expect(() => repo.setSplits(id, [{ category_id: g, amount: -12000 }, { category_id: h, amount: 2000 }])).toThrow(/same direction/);
    repo.setSplits(id, [{ category_id: g, amount: -6000 }, { category_id: h, amount: -4000 }]);
    const cats = repo.byCategory('2026-02-01', '2026-02-28'); expect(cats.find((c) => c.name === 'Groceries')!.total).toBe(6000); expect(cats.find((c) => c.name === 'Health')!.total).toBe(4000);
  });
  it('editing a split transaction amount clears stale splits', async () => {
    const { repo, acct } = await freshRepo(); const id = repo.addTx({ account_id: acct, date: '2026-02-01', amount: -10000, description: 'Mall' });
    repo.setSplits(id, [{ category_id: 3, amount: -5000 }, { category_id: 4, amount: -5000 }]); repo.updateTx(id, { amount: -9000 }); expect(repo.splits(id)).toHaveLength(0); expect(repo.byCategory('2026-02-01', '2026-02-28').reduce((s, c) => s + c.total, 0)).toBe(9000);
  });
  it('transfers move balance but never count as income/expense; deleting removes both legs', async () => {
    const { repo, acct } = await freshRepo(); const sav = repo.addAccount('Savings', 'savings', 0);
    repo.addTx({ account_id: acct, date: '2026-02-01', amount: 100000, description: 'Salary' }); repo.addTransfer(acct, sav, 40000, '2026-02-02');
    expect(repo.balance(acct)).toBe(60000); expect(repo.balance(sav)).toBe(40000); expect(repo.incomeExpense('2026-02-01', '2026-02-28')).toEqual({ income: 100000, expense: 0, net: 100000 });
    const leg = repo.list().find((t) => t.transfer_group)!; repo.deleteTx([leg.id]); expect(repo.balance(sav)).toBe(0); expect(repo.balance(acct)).toBe(100000);
    expect(() => repo.addTransfer(acct, acct, 100, '2026-02-02')).toThrow();
  });
  it('balance includes opening balance and respects as-of date', async () => {
    const { repo, acct } = await freshRepo(); const a2 = repo.addAccount('Opening', 'cash', 50000);
    repo.addTx({ account_id: a2, date: '2026-02-01', amount: -1000, description: 'a' }); repo.addTx({ account_id: a2, date: '2026-03-01', amount: -2000, description: 'b' });
    expect(repo.balance(a2)).toBe(47000); expect(repo.balance(a2, '2026-02-15')).toBe(49000); void acct;
  });
  it('negative amounts and extreme values', async () => {
    const { repo, acct } = await freshRepo(); expect(() => repo.addTx({ account_id: acct, date: '2026-01-01', amount: 1e16, description: 'x' })).toThrow(/too large/);
    repo.addTx({ account_id: acct, date: '2026-01-01', amount: -999_999_999_999, description: 'big' }); expect(repo.balance(acct)).toBe(-999_999_999_999);
  });
  it('recurring: generates missed occurrences once (idempotent), clamps month ends', async () => {
    const { repo, acct } = await freshRepo(); const id = repo.addRecurring({ account_id: acct, description: 'Netflix', amount: -450000, category_id: null, frequency: 'monthly', next_due: '2026-01-31' });
    expect(repo.dueRecurring('2026-04-01')).toHaveLength(1); expect(repo.generateRecurring(id, '2026-04-01')).toBe(3); expect(repo.generateRecurring(id, '2026-04-01')).toBe(0);
    expect(repo.list().map((t) => t.date).sort()).toEqual(['2026-01-31', '2026-02-28', '2026-03-28']);
  });
  it('budgets and goals validate', async () => {
    const { repo } = await freshRepo(); expect(() => repo.setBudget(3, 0)).toThrow(); repo.setBudget(3, 5000000); repo.setBudget(3, 6000000); expect(repo.budgets()).toHaveLength(1); expect(() => repo.addGoal('x', 0, null)).toThrow();
    const g = repo.addGoal('Laptop', 90000000, '2026-12-01'); repo.contributeGoal(g, 1000); expect(repo.goals()[0].saved).toBe(1000);
  });
  it('50k transactions: queries stay fast', async () => {
    const { repo, acct, db } = await freshRepo(); const t0 = Date.now();
    db.tx(() => { for (let i = 0; i < 50000; i++) repo.addTx({ account_id: acct, date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, amount: -((i % 500) + 1) * 100, description: `Merchant ${i % 300}`, category_id: (i % 15) + 3 }); });
    const ins = Date.now() - t0; const t1 = Date.now(); const by = repo.byCategory('2025-01-01', '2025-12-31'); const ie = repo.incomeExpense('2025-03-01', '2025-03-31'); repo.list({ q: 'Merchant 42', limit: 100 }); const q = Date.now() - t1;
    expect(by.length).toBeGreaterThan(5); expect(ie.expense).toBeGreaterThan(0); expect(repo.count()).toBe(50000);
    console.log(`50k insert ${ins}ms, report queries ${q}ms`); expect(q).toBeLessThan(2500);
  }, 60000);
});
describe('receipts', () => {
  it('stores attachments inside the DB, de-duplicates by hash, validates type/size, cleans up', async () => {
    const { repo, acct } = await freshRepo(); const a = repo.addTx({ account_id: acct, date: '2026-02-01', amount: -100, description: 'x' }), b = repo.addTx({ account_id: acct, date: '2026-02-01', amount: -100, description: 'y' });
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]); const h1 = repo.attach(a, 'r.png', 'image/png', png), h2 = repo.attach(b, 'r2.png', 'image/png', png); expect(h1).toBe(h2);
    expect(repo.db.scalar('SELECT COUNT(*) FROM attachments')).toBe(1); expect(repo.attachment(h1)!.data).toEqual(png);
    expect(() => repo.attach(a, 'x.exe', 'application/x-msdownload', png)).toThrow(/PNG/); expect(() => repo.attach(a, 'big.png', 'image/png', new Uint8Array(3 * 1024 * 1024 + 1))).toThrow(/3 MB/);
    repo.detach(a); expect(repo.db.scalar('SELECT COUNT(*) FROM attachments')).toBe(1); repo.detach(b); expect(repo.db.scalar('SELECT COUNT(*) FROM attachments')).toBe(0);
  });
});

describe('plain local vault (no passphrase)', () => {
  it('opens straight away, persists across reopen, and stores a normal SQLite file', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); const s = await vm.openPlain();
    s.db.run("INSERT INTO accounts(name,kind) VALUES('Cash','cash')"); s.touch(0); await s.flush();
    const raw = (await store.get(`vault/${s.id}`))!; expect(new TextDecoder('latin1').decode(raw.slice(0, 15))).toBe('SQLite format 3');
    const s2 = await vm.openPlain(); expect(s2.id).toBe(s.id); expect(s2.db.scalar<string>('SELECT name FROM accounts')).toBe('Cash'); expect((await vm.list())).toHaveLength(1);
  });
  it('recovers from a corrupt main file using the previous snapshot', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); const s = await vm.openPlain(); s.touch(0); await s.flush(); s.db.run("INSERT INTO accounts(name,kind) VALUES('A','cash')"); s.touch(0); await s.flush();
    await store.put(`vault/${s.id}`, new TextEncoder().encode('garbage garbage garbage garbage')); const s2 = await vm.openPlain(); expect(s2.db.integrityOk()).toBe(true);
  });
  it('backup restore validates the file before replacing anything', async () => {
    const vm = new VaultManager(new MemoryStore()); const s = await vm.openPlain(); await expect(vm.restorePlain(s.id, new TextEncoder().encode('not a database at all, sorry'))).rejects.toThrow();
    const donor = await createEmptyDb(); donor.run("INSERT INTO accounts(name,kind) VALUES('FromBackup','cash')"); await vm.restorePlain(s.id, donor.export()); expect((await vm.openPlain()).db.scalar<string>('SELECT name FROM accounts')).toBe('FromBackup');
  });
  it('explains an old passphrase-protected vault instead of failing silently', async () => {
    const store = new MemoryStore(); const vm = new VaultManager(store); await vm.create('Old', 'lantern-orbit-ferry-77', FAST_KDF); await expect(vm.openPlain()).rejects.toThrow(/older passphrase-protected/);
  });
});
