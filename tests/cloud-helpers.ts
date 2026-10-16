import pg from 'pg';
// @ts-ignore plain JS server modules
import { createHandler } from '../api/_lib/handler.js';

export const TEST_DB = process.env.TEST_DATABASE_URL;
export const KEY = 'test-access-key-0123456789abcdef';

/** A throwaway cloud: a fresh `tally` schema in the test Postgres plus a fetch() that talks straight to the real handler. */
export async function freshCloud(opts: { key?: string | undefined } = {}) {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 }); await admin.query('DROP SCHEMA IF EXISTS tally CASCADE'); await admin.end();
  const pool = new pg.Pool({ connectionString: TEST_DB, max: 6 });
  const handler = createHandler({ getPool: () => pool, accessKey: () => ('key' in opts ? opts.key : KEY) });
  const calls: { method: string; url: string }[] = []; let down = false;
  const fetchImpl = async (input: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) => {
    if (down) throw new TypeError('Failed to fetch'); calls.push({ method: init.method ?? 'GET', url: String(input) });
    const headers: Record<string, string> = {}; for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    const req = { method: init.method ?? 'GET', url: String(input), headers, body: init.body };
    let status = 200; const h: Record<string, string> = {}; let out = '';
    const res = { set statusCode(v: number) { status = v; }, get statusCode() { return status; }, setHeader(k: string, v: string) { h[k] = v; }, end(s: string) { out = s; } };
    await handler(req, res);
    return new Response(out, { status, headers: h });
  };
  return { pool, fetchImpl, calls, setDown: (v: boolean) => { down = v; }, close: () => pool.end(), query: (sql: string, p?: unknown[]) => pool.query(sql, p as never) };
}
export const auth = (key = KEY) => ({ Authorization: `Bearer ${key}` });
