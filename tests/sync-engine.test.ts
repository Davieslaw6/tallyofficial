import { describe, it, expect } from 'vitest';
import { createBareDb, createEmptyDb } from '../src/core/db';
import { Repo } from '../src/core/repo';
import { loadSample } from '../src/core/sample';
import { SYNC_TABLES } from '../shared/sync-tables.js';
import { enableTracking, disableTracking, trackingOn, collectChanges, ackChanges, markAllDirty, dirtyCount, loadSnapshot, getVersion, setVersion, type Change } from '../src/core/sync/engine';
import { logEvent } from '../src/core/audit';
import { freshRepo } from './helpers';

const keysOf = (db: any) => db.all('SELECT tbl, pk FROM sync_dirty ORDER BY tbl, CAST(pk AS INTEGER), pk').map((r: any) => `${r.tbl}:${r.pk}`);

describe('sync tables match the real SQLite schema (no drift between app and server)', () => {
  it('every synced table and column exists, keys are right, and no table is forgotten', async () => {
    const { db } = await freshRepo(); const names = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
    for (const t of SYNC_TABLES) {
      const info = db.all<{ name: string; pk: number }>(`PRAGMA table_info("${t.name}")`); expect(info.map((c) => c.name).sort(), t.name).toEqual(t.cols.map(([n]) => n).sort());
      expect(info.find((c) => c.pk === 1)?.name, `${t.name} pk`).toBe(t.pk);
    }
    expect(names.filter((n) => n !== 'schema_migrations' && !SYNC_TABLES.some((t) => t.name === n))).toEqual([]);
  });
});

describe('change tracking', () => {
  it('is off by default (local mode pays nothing) and can be switched on and off cleanly', async () => {
    const { db } = await freshRepo(); expect(trackingOn(db)).toBe(false); enableTracking(db); enableTracking(db); expect(trackingOn(db)).toBe(true);
    expect(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trk_%'")).toBe(SYNC_TABLES.length * 3);
    disableTracking(db); expect(trackingOn(db)).toBe(false); expect(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trk_%'")).toBe(0);
  });
  it('records inserts, updates and deletes, including cascades, text keys and the audit log', async () => {
    const { db, repo, acct } = await freshRepo(); enableTracking(db); expect(dirtyCount(db)).toBe(0);
    const id = repo.addTx({ account_id: acct, date: '2026-03-01', amount: -1000, description: 'Shop' }); expect(keysOf(db)).toEqual([`transactions:${id}`]);
    ackChanges(db, db.all('SELECT tbl, pk, seq FROM sync_dirty')); expect(dirtyCount(db)).toBe(0);
    repo.updateTx(id, { description: 'Shop 2' }); expect(keysOf(db)).toEqual([`transactions:${id}`]);
    ackChanges(db, db.all('SELECT tbl, pk, seq FROM sync_dirty'));
    repo.setSplits(id, [{ category_id: 3, amount: -600 }, { category_id: 4, amount: -400 }]); expect(keysOf(db).filter((k: string) => k.startsWith('splits:'))).toHaveLength(2); expect(keysOf(db)).toContain(`transactions:${id}`);
    ackChanges(db, db.all('SELECT tbl, pk, seq FROM sync_dirty'));
    repo.deleteTx([id]); expect(keysOf(db)).toEqual(expect.arrayContaining([`transactions:${id}`])); expect(keysOf(db).filter((k: string) => k.startsWith('splits:'))).toHaveLength(2); // cascaded child rows are queued as deletes too
    ackChanges(db, db.all('SELECT tbl, pk, seq FROM sync_dirty'));
    db.run("INSERT INTO settings(key, value) VALUES ('theme', 'dark')"); db.run("INSERT INTO model_state(profile_id, json) VALUES (1, '{}')"); logEvent(db, 'settings', 'x');
    const png = new Uint8Array([1, 2, 3]); const t2 = repo.addTx({ account_id: acct, date: '2026-03-02', amount: -5, description: 'r' }); repo.attach(t2, 'r.png', 'image/png', png);
    const k = keysOf(db); expect(k).toEqual(expect.arrayContaining(['settings:theme', 'model_state:1', expect.stringMatching(/^audit_log:\d+$/), expect.stringMatching(/^attachments:[0-9a-f]{64}$/)]));
  });
  it('collects upserts for rows that exist and deletes for rows that are gone', async () => {
    const { db, repo, acct } = await freshRepo(); enableTracking(db);
    const a = repo.addTx({ account_id: acct, date: '2026-03-01', amount: -1, description: 'a' }), b = repo.addTx({ account_id: acct, date: '2026-03-01', amount: -2, description: 'b' }); repo.deleteTx([b]);
    const { changes } = collectChanges(db); const tx = changes.find((c) => c.table === 'transactions')!; expect(tx.upserts.map((r) => r[0])).toEqual([a]); expect(tx.deletes).toEqual([b]); // insert-then-delete → a delete (harmless on the server)
  });
  it('an edit made while an upload is in flight stays queued; only what was sent is cleared', async () => {
    const { db, repo, acct } = await freshRepo(); enableTracking(db); const id = repo.addTx({ account_id: acct, date: '2026-03-01', amount: -1, description: 'v1' });
    const batch = collectChanges(db); repo.updateTx(id, { description: 'v2' }); // happens "during" the request
    ackChanges(db, batch.keys); expect(keysOf(db)).toEqual([`transactions:${id}`]); // still queued, so v2 will upload
    const again = collectChanges(db); expect((again.changes[0].upserts[0] as unknown[])[5]).toBe('v2');
  });
  it('batches by size, and sends attachments alone', async () => {
    const { db, repo, acct } = await freshRepo(); enableTracking(db); const png = new Uint8Array(200_000).fill(7);
    for (let i = 0; i < 3; i++) { const t = repo.addTx({ account_id: acct, date: '2026-03-01', amount: -i - 1, description: 'r' + i }); repo.attach(t, `r${i}.png`, 'image/png', new Uint8Array(png.map((v, j) => (v + i + j) % 256))); }
    let sent = 0, rounds = 0; for (;;) { const b = collectChanges(db, { maxBytes: 400_000 }); if (!b.keys.length) break; rounds++; expect(b.bytes).toBeLessThan(700_000); sent += b.keys.length; ackChanges(db, b.keys); }
    expect(dirtyCount(db)).toBe(0); expect(rounds).toBeGreaterThanOrEqual(3); expect(sent).toBe(6); // 3 transactions + 3 attachments
  });
  it('markAllDirty queues every row of every table', async () => {
    const { db } = await freshRepo(); loadSample(new Repo(db), '2026-10-11'); enableTracking(db); markAllDirty(db);
    const total = SYNC_TABLES.reduce((s, t) => s + (db.scalar<number>(`SELECT COUNT(*) FROM "${t.name}"`) ?? 0), 0); expect(dirtyCount(db)).toBe(total);
  });
  it('version bookkeeping', async () => { const { db } = await freshRepo(); enableTracking(db); expect(getVersion(db)).toBeNull(); setVersion(db, 7); setVersion(db, 9); expect(getVersion(db)).toBe(9); });
});

describe('snapshot rebuild', () => {
  it('collect everything → load into an empty database → identical rows, balances and reports', async () => {
    const { db, repo } = await freshRepo(); loadSample(repo, '2026-10-11'); const t = repo.db.one<{ id: number }>('SELECT id FROM transactions WHERE amount < 0 LIMIT 1')!; repo.attach(t.id, 'r.png', 'image/png', new Uint8Array([9, 8, 7, 0, 255]));
    repo.setSplits(t.id, [{ category_id: 3, amount: Math.trunc(repo.list().find((x) => x.id === t.id)!.amount / 2) }, { category_id: 4, amount: repo.list().find((x) => x.id === t.id)!.amount - Math.trunc(repo.list().find((x) => x.id === t.id)!.amount / 2) }]);
    logEvent(db, 'import', 'sample'); enableTracking(db); markAllDirty(db);
    const data: Record<string, unknown[][]> = {}; for (;;) { const b = collectChanges(db, { maxRows: 5000, maxBytes: 50_000_000 }); if (!b.keys.length) break; for (const c of b.changes as Change[]) (data[c.table] ??= []).push(...c.upserts); ackChanges(db, b.keys); }
    const copy = await createBareDb(); loadSnapshot(copy, data); const r2 = new Repo(copy);
    for (const tb of SYNC_TABLES) { const q = `SELECT * FROM "${tb.name}" ORDER BY "${tb.pk}"`; expect(JSON.stringify(copy.all(q)), tb.name).toBe(JSON.stringify(db.all(q))); }
    expect(r2.incomeExpense('2026-01-01', '2026-12-31')).toEqual(repo.incomeExpense('2026-01-01', '2026-12-31')); expect(r2.accounts().map((a) => r2.balance(a.id))).toEqual(repo.accounts().map((a) => repo.balance(a.id)));
    expect(r2.attachment(r2.list().find((x) => x.attachment_hash)!.attachment_hash!)!.data).toEqual(new Uint8Array([9, 8, 7, 0, 255])); expect(copy.integrityOk()).toBe(true);
    expect(copy.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(dirtyCount(db)).toBe(0); expect(trackingOn(copy)).toBe(false); // loading itself never queues anything
  });
  it('tracking 50,000 inserts adds little overhead', async () => {
    const { db, repo, acct } = await freshRepo(); enableTracking(db); const t0 = Date.now();
    db.tx(() => { for (let i = 0; i < 50000; i++) repo.addTx({ account_id: acct, date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, amount: -((i % 500) + 1) * 100, description: `Merchant ${i % 300}`, category_id: (i % 15) + 3 }); });
    const ms = Date.now() - t0; console.log(`50k tracked inserts: ${ms}ms`); expect(dirtyCount(db)).toBe(50000); expect(ms).toBeLessThan(20000);
  }, 60000);
});
void createEmptyDb;
