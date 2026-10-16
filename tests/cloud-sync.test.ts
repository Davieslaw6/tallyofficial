import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshCloud, TEST_DB, KEY } from './cloud-helpers';
import { createEmptyDb } from '../src/core/db';
import { VaultManager, MemoryStore, type Session } from '../src/core/vault';
import { Repo } from '../src/core/repo';
import { loadSample } from '../src/core/sample';
import { SyncClient, SyncError } from '../src/core/sync/client';
import { SyncController } from '../src/core/sync/controller';
import { openCloud, restoreAndUpload, leaveCloud } from '../src/core/sync/open';
import { dirtyCount, getVersion, trackingOn, hasUserData } from '../src/core/sync/engine';

type Cloud = Awaited<ReturnType<typeof freshCloud>>;
const d = describe.skipIf(!TEST_DB);
const FAST = { debounceMs: 5, retryOfflineMs: 20, retryServerMs: 20, chunkRows: 1000 };
const TODAY = '2026-10-11';

/** A "device" = its own local store + session, like a separate browser. */
async function device(c: Cloud, key = KEY) {
  const vm = new VaultManager(new MemoryStore()); const session = await vm.openPlain(); const client = new SyncClient({ key, fetchImpl: c.fetchImpl as never });
  return { vm, session, client, repo: () => new Repo(session.db) };
}
async function open(dev: Awaited<ReturnType<typeof device>>) { const r = await openCloud(dev.session, dev.client, FAST); if (r.kind !== 'ready') throw new Error('unexpected conflict'); return r.controller; }
const cloudCount = async (c: Cloud, t = 'transactions') => (await c.query(`SELECT count(*)::int n FROM tally.${t}`)).rows[0].n;

d('cloud sync end to end (two devices, real Postgres)', () => {
  let c: Cloud; beforeEach(async () => { c = await freshCloud(); }); afterEach(async () => { await c.close(); });

  it('first device links to an empty cloud: everything uploads and rows are real, queryable Postgres rows', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ctl = await open(a); await ctl.flush();
    expect(ctl.status).toBe('synced'); expect(dirtyCount(a.session.db)).toBe(0);
    const local = a.repo().count(); expect(await cloudCount(c)).toBe(local); expect(await cloudCount(c, 'categories')).toBe(18); expect(await cloudCount(c, 'accounts')).toBe(2);
    const sum = (await c.query('SELECT sum(amount)::bigint s FROM tally.transactions WHERE amount < 0 AND transfer_group IS NULL')).rows[0].s; // a real SQL question answered by Neon itself
    expect(Number(sum)).toBe(a.repo().db.scalar<number>('SELECT SUM(amount) FROM transactions WHERE amount < 0 AND transfer_group IS NULL')!);
    expect(getVersion(a.session.db)).toBeGreaterThan(0);
  });
  it('each new edit is pushed (debounced) and only the changed rows travel', async () => {
    const a = await device(c); const ctl = await open(a); await ctl.flush(); const acct = a.repo().addAccount('Cash', 'cash'); a.session.touch(); await ctl.flush();
    c.calls.length = 0; const id = a.repo().addTx({ account_id: acct, date: TODAY, amount: -150000, description: 'Lunch' }); a.session.touch(); await new Promise((r) => setTimeout(r, 60)); await ctl.flush();
    expect(c.calls.filter((x) => x.method === 'POST')).toHaveLength(1); expect(await cloudCount(c)).toBe(1);
    expect((await c.query('SELECT description, amount::int AS amount FROM tally.transactions WHERE id=$1', [id])).rows[0]).toEqual({ description: 'Lunch', amount: -150000 });
    a.repo().deleteTx([id]); a.session.touch(); await ctl.flush(); expect(await cloudCount(c)).toBe(0);
  });
  it('a second, empty device pulls everything and shows identical numbers', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ca = await open(a); await ca.flush();
    const b = await device(c); expect(hasUserData(b.session.db)).toBe(false); await open(b);
    expect(b.repo().count()).toBe(a.repo().count()); expect(b.repo().incomeExpense('2026-01-01', '2026-12-31')).toEqual(a.repo().incomeExpense('2026-01-01', '2026-12-31'));
    expect(b.repo().accounts().map((x) => b.repo().balance(x.id))).toEqual(a.repo().accounts().map((x) => a.repo().balance(x.id))); expect(b.session.db.integrityOk()).toBe(true); expect(dirtyCount(b.session.db)).toBe(0);
  });
  it('changes flow both ways: B adds, A (nothing unsent) catches up when it next opens', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ca = await open(a); await ca.flush();
    const b = await device(c); const cb = await open(b); const acct = b.repo().accounts()[0].id; b.repo().addTx({ account_id: acct, date: TODAY, amount: -777700, description: 'FROM DEVICE B' }); b.session.touch(); await cb.flush();
    const a2 = await openCloud(a.session, a.client, FAST); expect(a2.kind).toBe('ready'); expect(a.repo().list({ q: 'FROM DEVICE B' })).toHaveLength(1);
  });
  it('conflict: both devices edited since they last synced → nothing is overwritten until the user chooses', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ca = await open(a); await ca.flush();
    const b = await device(c); const cb = await open(b); const ac = a.repo().accounts()[0].id;
    b.repo().addTx({ account_id: ac, date: TODAY, amount: -111100, description: 'B WINS?' }); b.session.touch(); await cb.flush();
    a.repo().addTx({ account_id: ac, date: TODAY, amount: -222200, description: 'A WINS?' }); a.session.touch(); await ca.flush(); // A is stale: refused
    expect(ca.status).toBe('conflict'); expect((await c.query(`SELECT 1 FROM tally.transactions WHERE description='B WINS?'`)).rowCount).toBe(1); expect((await c.query(`SELECT 1 FROM tally.transactions WHERE description='A WINS?'`)).rowCount).toBe(0); // the refused edit never reached the cloud
    const r = await openCloud(a.session, a.client, FAST); expect(r.kind).toBe('conflict'); if (r.kind !== 'conflict') return; expect(r.info.reason).toBe('diverged'); expect(r.info.device.pending).toBeGreaterThan(0);
    // choose the cloud: A's unsent edit is discarded, B's is kept
    await r.resolve('cloud'); expect(a.repo().list({ q: 'B WINS?' })).toHaveLength(1); expect(a.repo().list({ q: 'A WINS?' })).toHaveLength(0);
  });
  it('conflict resolved the other way: this device replaces the cloud', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ca = await open(a); await ca.flush(); const b = await device(c); const cb = await open(b); const ac = a.repo().accounts()[0].id;
    b.repo().addTx({ account_id: ac, date: TODAY, amount: -111100, description: 'B ONLY' }); b.session.touch(); await cb.flush();
    a.repo().addTx({ account_id: ac, date: TODAY, amount: -222200, description: 'A ONLY' }); a.session.touch(); await ca.flush();
    const r = await openCloud(a.session, a.client, FAST); if (r.kind !== 'conflict') throw new Error('expected conflict'); const ctl = await r.resolve('device'); await ctl.flush();
    expect((await c.query(`SELECT description FROM tally.transactions WHERE description IN ('A ONLY','B ONLY')`)).rows.map((x: any) => x.description)).toEqual(['A ONLY']); expect(await cloudCount(c)).toBe(a.repo().count()); expect(ctl.status).toBe('synced');
  });
  it('linking a device that already has data to a cloud that also has data asks, never merges silently', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); await (await open(a)).flush();
    const other = await device(c); other.repo().addAccount('Local only', 'cash'); const r = await openCloud(other.session, other.client, FAST); expect(r.kind).toBe('conflict'); if (r.kind === 'conflict') expect(r.info.reason).toBe('first-link');
  });
  it('offline: edits are kept on the device, status says so, and they upload once the connection returns', async () => {
    const a = await device(c); const ctl = await open(a); await ctl.flush(); const acct = a.repo().addAccount('Cash', 'cash'); a.session.touch(); await ctl.flush();
    c.setDown(true); a.repo().addTx({ account_id: acct, date: TODAY, amount: -5000, description: 'Offline purchase' }); a.session.touch(); await ctl.flush();
    expect(ctl.status).toBe('offline'); expect(ctl.pending).toBeGreaterThan(0); expect(await cloudCount(c)).toBe(0);
    c.setDown(false); await new Promise((r) => setTimeout(r, 80)); await ctl.flush(); expect(ctl.status).toBe('synced'); expect(await cloudCount(c)).toBe(1);
  });
  it('a device that closes while offline keeps its queue: reopening later still uploads', async () => {
    const a = await device(c); const ctl = await open(a); await ctl.flush(); const acct = a.repo().addAccount('Cash', 'cash'); a.session.touch(); await ctl.flush();
    c.setDown(true); a.repo().addTx({ account_id: acct, date: TODAY, amount: -5000, description: 'Queued' }); a.session.touch(0); await a.session.flush(); // saved to the device cache
    const reopened = await a.vm.openPlain(); expect(dirtyCount(reopened.db)).toBeGreaterThan(0); expect(trackingOn(reopened.db)).toBe(true);
    const r = await openCloud(reopened, a.client, FAST); expect(r.kind).toBe('ready'); if (r.kind === 'ready') expect(r.controller.status).toBe('offline');
    c.setDown(false); const r2 = await openCloud(reopened, a.client, FAST); expect(r2.kind).toBe('ready'); if (r2.kind === 'ready') { await r2.controller.flush(); expect(await cloudCount(c)).toBe(1); }
  });
  it('a brand-new device cannot start while the cloud is unreachable (nothing to show); a wrong key is reported clearly', async () => {
    const x = await device(c); c.setDown(true); await expect(openCloud(x.session, x.client, FAST)).rejects.toMatchObject({ kind: 'offline' }); c.setDown(false);
    const bad = await device(c, 'definitely-the-wrong-key-123'); await expect(openCloud(bad.session, bad.client, FAST)).rejects.toMatchObject({ kind: 'auth' });
  });
  it('large uploads go out in several requests and arrive complete (and a 50k-row cloud loads back)', async () => {
    const a = await device(c); const repo = a.repo(); const acct = repo.addAccount('Big', 'checking'); const ctl = await open(a); await ctl.flush();
    a.session.db.tx(() => { for (let i = 0; i < 20000; i++) repo.addTx({ account_id: acct, date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, amount: -((i % 500) + 1) * 100, description: `POS MERCHANT ${i % 300} REF ${i}`, category_id: (i % 15) + 3 }); });
    c.calls.length = 0; const t0 = Date.now(); a.session.touch(); await ctl.flush(); const up = Date.now() - t0;
    expect(c.calls.filter((x) => x.method === 'POST').length).toBeGreaterThanOrEqual(7); expect(await cloudCount(c)).toBe(20000);
    const b = await device(c); const t1 = Date.now(); await open(b); const down = Date.now() - t1; expect(b.repo().count()).toBe(20000);
    expect(b.repo().incomeExpense('2025-01-01', '2025-12-31')).toEqual(repo.incomeExpense('2025-01-01', '2025-12-31')); console.log(`20k rows: upload ${up}ms, fresh-device download+rebuild ${down}ms`);
  }, 120000);
  it('restoring a backup in cloud mode makes it the new cloud copy (cloud is cleared first)', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ca = await open(a); await ca.flush();
    const backupDb = await createEmptyDb(); const br = new Repo(backupDb); const x = br.addAccount('From backup', 'cash'); br.addTx({ account_id: x, date: TODAY, amount: -9900, description: 'Restored' });
    await restoreAndUpload(a.session, ca, a.client, backupDb.export()); await ca.flush();
    expect(await cloudCount(c, 'accounts')).toBe(1); expect(await cloudCount(c)).toBe(1); expect(a.repo().accounts().map((r) => r.name)).toEqual(['From backup']); expect(ca.status).toBe('synced');
    c.setDown(true); const before = a.repo().count(); await expect(restoreAndUpload(a.session, ca, a.client, backupDb.export())).rejects.toBeInstanceOf(SyncError); expect(a.repo().count()).toBe(before); // failure leaves the device untouched
  });
  it('if the tables are removed behind the server’s back it recreates them and carries on (no restart needed)', async () => {
    const a = await device(c); const ctl = await open(a); await ctl.flush(); await c.query('DROP SCHEMA tally CASCADE');
    expect((await a.client.meta()).version).toBe(0); // healed: fresh, empty cloud
  });
  it('leaving cloud mode keeps the local data and stops tracking; the cloud is untouched', async () => {
    const a = await device(c); loadSample(a.repo(), TODAY); const ca = await open(a); await ca.flush(); const n = a.repo().count();
    leaveCloud(a.session); expect(trackingOn(a.session.db)).toBe(false); a.repo().addTx({ account_id: a.repo().accounts()[0].id, date: TODAY, amount: -1, description: 'local only now' }); expect(await cloudCount(c)).toBe(n); expect(a.repo().count()).toBe(n + 1);
  });
  it('a server fault is shown as an error and retried; a missing server config is reported without retry loops', async () => {
    const a = await device(c); const ctl = await open(a); await ctl.flush(); const acct = a.repo().addAccount('Cash', 'cash'); a.session.touch(); await ctl.flush();
    await c.query('ALTER TABLE tally.transactions RENAME COLUMN description TO desc_away'); a.repo().addTx({ account_id: acct, date: TODAY, amount: -1, description: 'x' }); a.session.touch(); await ctl.flush();
    expect(ctl.status).toBe('error'); expect(ctl.message).not.toMatch(/desc_away|column|SQL/i); // internals never leak to the page
    await c.query('ALTER TABLE tally.transactions RENAME COLUMN desc_away TO description'); await new Promise((r) => setTimeout(r, 80)); await ctl.flush(); expect(ctl.status).toBe('synced');
  });
});
void SyncController;
