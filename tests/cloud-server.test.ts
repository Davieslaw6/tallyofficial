import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshCloud, auth, TEST_DB, KEY } from './cloud-helpers';
import { SYNC_VERSION, TABLE_BY_NAME } from '../shared/sync-tables.js';

type Cloud = Awaited<ReturnType<typeof freshCloud>>;
const d = describe.skipIf(!TEST_DB);

d('cloud server (real Postgres)', () => {
  let c: Cloud;
  beforeEach(async () => { c = await freshCloud(); }); afterEach(async () => { await c.close(); });
  const get = async (qs: string, h = auth()) => { const r = await c.fetchImpl(`/api/sync?${qs}`, { headers: h }); return { status: r.status, body: await r.json() as any }; };
  const post = async (op: string, body: unknown, h = auth()) => { const r = await c.fetchImpl(`/api/sync?op=${op}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
  const acct = (id: number, name = 'GT') => [id, 1, name, 'checking', 0, null, 0];
  const push = (baseVersion: number, changes: unknown[]) => post('push', { v: SYNC_VERSION, baseVersion, changes });

  it('requires the access key: 401 without or with a wrong key, 503 when the server has none', async () => {
    expect((await get('op=meta', {} as never)).status).toBe(401); expect((await get('op=meta', auth('wrong-key-wrong-key-wrong'))).status).toBe(401);
    expect((await get('op=meta')).status).toBe(200);
    const off = await freshCloud({ key: undefined }); const r = await off.fetchImpl('/api/sync?op=meta', { headers: auth() }); expect(r.status).toBe(503); await off.close();
    const short = await freshCloud({ key: 'short' }); expect((await short.fetchImpl('/api/sync?op=meta', { headers: auth('short') })).status).toBe(503); await short.close();
  });
  it('creates the schema on first use; empty cloud reports version 0', async () => {
    const r = await get('op=meta'); expect(r.body).toMatchObject({ version: 0, counts: { accounts: 0, transactions: 0 } });
    const t = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='tally'`); expect(t.rows.map((x: any) => x.table_name)).toEqual(expect.arrayContaining(['transactions', 'accounts', 'meta', 'attachments']));
  });
  it('round-trips every column type exactly: big integers, reals, nulls, unicode, injection text, binary', async () => {
    const nasty = "Robert'); DROP TABLE tally.transactions;-- ₦ 日本語 🚀 \"quoted\" \\ back";
    const png = Buffer.from([137, 80, 78, 71, 0, 255, 1, 2]).toString('base64');
    const tx = [9007199254740, 1, 1, '2026-03-01', -999999999999999, nasty, 'm', null, 't', 'n', null, 0, 'pdf', 'hash', null, null, 0.97, null, '2026-03-01 10:00:00'];
    const r1 = await push(0, [{ table: 'accounts', upserts: [acct(1)] }, { table: 'transactions', upserts: [tx] }, { table: 'attachments', upserts: [['abc', 'r.png', 'image/png', 8, png]] }, { table: 'budgets', upserts: [[1, 1, 3, 500000, 0.8]] }]);
    expect(r1.status).toBe(200); expect(r1.body.version).toBe(1);
    const p = await get('op=pull&table=transactions'); expect(p.body.rows[0]).toEqual(tx);
    expect((await get('op=pull&table=attachments')).body.rows[0][4]).toBe(png); expect((await get('op=pull&table=budgets')).body.rows[0][4]).toBe(0.8);
    expect((await c.query('SELECT count(*)::int n FROM tally.transactions')).rows[0].n).toBe(1); // the injection string was data, not SQL
  });
  it('version check: a stale baseVersion is refused with 409 and the current version', async () => {
    expect((await push(0, [{ table: 'accounts', upserts: [acct(1)] }])).body.version).toBe(1);
    const stale = await push(0, [{ table: 'accounts', upserts: [acct(2)] }]); expect(stale.status).toBe(409); expect(stale.body).toMatchObject({ error: 'conflict', version: 1 });
    expect((await c.query('SELECT count(*)::int n FROM tally.accounts')).rows[0].n).toBe(1); // nothing from the refused push was applied
    expect((await push(1, [{ table: 'accounts', upserts: [acct(2)] }])).body.version).toBe(2);
  });
  it('two simultaneous pushes from the same version: exactly one wins', async () => {
    const results = await Promise.all([push(0, [{ table: 'accounts', upserts: [acct(1, 'A')] }]), push(0, [{ table: 'accounts', upserts: [acct(2, 'B')] }])]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]); expect((await c.query('SELECT count(*)::int n FROM tally.accounts')).rows[0].n).toBe(1);
  });
  it('upsert updates, delete removes, duplicate keys in one request keep the last', async () => {
    await push(0, [{ table: 'accounts', upserts: [acct(1, 'old'), acct(2, 'two')] }]);
    await push(1, [{ table: 'accounts', upserts: [acct(1, 'first'), acct(1, 'last')], deletes: [2] }]);
    const rows = (await get('op=pull&table=accounts')).body.rows; expect(rows).toHaveLength(1); expect(rows[0][2]).toBe('last');
  });
  it('an empty push changes nothing and does not bump the version', async () => { expect((await push(0, [])).body).toMatchObject({ version: 0, applied: 0 }); });
  it('rejects malformed input and never touches the database', async () => {
    const bad: [string, unknown][] = [
      ['unknown table', [{ table: 'users', upserts: [] }]], ['table-name injection', [{ table: 'transactions"; DROP TABLE tally.accounts; --', upserts: [] }]],
      ['wrong column count', [{ table: 'accounts', upserts: [[1, 1, 'x']] }]], ['float in an integer column', [{ table: 'accounts', upserts: [[1.5, 1, 'x', 'checking', 0, null, 0]] }]],
      ['string in an integer column', [{ table: 'accounts', upserts: [['1', 1, 'x', 'checking', 0, null, 0]] }]], ['missing key', [{ table: 'accounts', upserts: [[null, 1, 'x', 'checking', 0, null, 0]] }]],
      ['number in a text column', [{ table: 'accounts', upserts: [[1, 1, 42, 'checking', 0, null, 0]] }]], ['bad base64', [{ table: 'attachments', upserts: [['h', 'n', 'm', 1, '!!!not base64!!!']] }]],
      ['unsafe integer', [{ table: 'accounts', upserts: [[1, 1, 'x', 'k', 2 ** 60, null, 0]] }]], ['changes not a list', { table: 'accounts' }],
    ];
    for (const [name, changes] of bad) { const r = await push(0, changes as never); expect(r.status, name).toBeGreaterThanOrEqual(400); expect(r.status, name).toBeLessThan(500); }
    expect((await get('op=meta')).body.version).toBe(0); expect((await c.query('SELECT count(*)::int n FROM tally.accounts')).rows[0].n).toBe(0);
    expect((await c.query(`SELECT to_regclass('tally.accounts') IS NOT NULL ok`)).rows[0].ok).toBe(true);
  });
  it('refuses oversized requests and a mismatched client schema version', async () => {
    const many = Array.from({ length: 3001 }, (_, i) => acct(i + 1)); expect((await push(0, [{ table: 'accounts', upserts: many }])).status).toBe(413);
    expect((await post('push', { v: 999, baseVersion: 0, changes: [] })).body.error).toBe('schema-mismatch');
  });
  it('NUL characters (illegal in Postgres text) are replaced instead of crashing the request', async () => {
    expect((await push(0, [{ table: 'accounts', upserts: [acct(1, 'a\u0000b')] }])).status).toBe(200); expect((await get('op=pull&table=accounts')).body.rows[0][2]).toBe('a b');
  });
  it('pull pages by key: integer and text keys, next cursor, bad table or cursor rejected', async () => {
    await push(0, [{ table: 'accounts', upserts: Array.from({ length: 12 }, (_, i) => acct(i + 1)) }, { table: 'settings', upserts: [['b', '2'], ['a', '1'], ['c', '3']] }]);
    let after: number | null = null; const pages: number[] = []; do { const r: any = await get(`op=pull&table=accounts&limit=5${after ? `&after=${after}` : ''}`); pages.push(r.body.rows.length); after = r.body.next; } while (after);
    expect(pages).toEqual([5, 5, 2]); const s = await get('op=pull&table=settings&limit=2'); expect(s.body.rows.map((x: string[]) => x[0])).toEqual(['a', 'b']); expect(s.body.next).toBe('b');
    expect((await get('op=pull&table=settings&limit=2&after=b')).body.rows.map((x: string[]) => x[0])).toEqual(['c']);
    expect((await get('op=pull&table=nope')).status).toBe(400); expect((await get('op=pull&table=accounts&after=abc')).status).toBe(400);
  });
  it('reset needs the confirmation word, empties everything and bumps the version', async () => {
    await push(0, [{ table: 'accounts', upserts: [acct(1)] }]); expect((await post('reset', {})).status).toBe(400);
    const r = await post('reset', { confirm: 'RESET' }); expect(r.body.version).toBe(2); expect((await get('op=meta')).body.counts.accounts).toBe(0);
  });
  it('unknown operations and wrong methods are 404; responses are never cached', async () => {
    expect((await get('op=whatever')).status).toBe(404); const r = await c.fetchImpl('/api/sync?op=push', { headers: auth() }); expect(r.status).toBe(404); expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('knows every table the client syncs', async () => { for (const name of Object.keys(TABLE_BY_NAME)) expect((await get(`op=pull&table=${name}&limit=1`)).status).toBe(200); });
  it('the key is never echoed back in any response', async () => { const r = await c.fetchImpl('/api/sync?op=meta', { headers: auth() }); expect(await r.text()).not.toContain(KEY); });
});
