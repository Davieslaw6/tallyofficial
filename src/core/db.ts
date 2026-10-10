import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { MIGRATIONS, DEFAULT_CATEGORIES } from './schema';

let SQL: SqlJsStatic | null = null;
/** Pass wasmBinary explicitly (browser: fetched from our own origin; tests: read from disk). */
export async function initEngine(wasmBinary?: ArrayBuffer): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs(wasmBinary ? ({ wasmBinary } as never) : undefined);
  return SQL;
}

export type Row = Record<string, SqlValue>;
export type Params = SqlValue[] | Record<string, SqlValue>;

export class Db {
  constructor(public raw: Database) { raw.run('PRAGMA foreign_keys = ON'); }
  run(sql: string, params: Params = []) { this.raw.run(sql, params as never); return { changes: this.raw.getRowsModified(), lastId: this.lastId() }; }
  lastId(): number { const r = this.raw.exec('SELECT last_insert_rowid()'); return Number(r[0].values[0][0]); }
  all<T = Row>(sql: string, params: Params = []): T[] {
    const st = this.raw.prepare(sql); const out: T[] = [];
    try { st.bind(params as never); while (st.step()) out.push(st.getAsObject() as T); } finally { st.free(); }
    return out;
  }
  one<T = Row>(sql: string, params: Params = []): T | undefined { return this.all<T>(sql, params)[0]; }
  scalar<T = number>(sql: string, params: Params = []): T | undefined { const r = this.one<Record<string, T>>(sql, params); return r ? Object.values(r)[0] : undefined; }
  /** Atomic unit of work — an interrupted import never leaves half-written rows. */
  tx<T>(fn: () => T): T {
    this.raw.run('BEGIN');
    try { const r = fn(); this.raw.run('COMMIT'); return r; } catch (e) { try { this.raw.run('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
  }
  export(): Uint8Array { return this.raw.export(); }
  integrityOk(): boolean { return this.scalar<string>('PRAGMA integrity_check') === 'ok'; }
  close() { this.raw.close(); }
}

export function migrate(db: Db): number {
  db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const current = db.scalar<number>('SELECT COALESCE(MAX(version),0) FROM schema_migrations') ?? 0;
  const applied = new Set(db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
  let latest = current;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.tx(() => { db.raw.exec(m.sql); db.run('INSERT INTO schema_migrations(version,name) VALUES(?,?)', [m.version, m.name]); });
    latest = m.version;
  }
  return latest;
}

export async function createEmptyDb(): Promise<Db> {
  const eng = await initEngine();
  const db = new Db(new eng.Database());
  migrate(db);
  db.tx(() => { for (const c of DEFAULT_CATEGORIES) db.run('INSERT INTO categories(name,kind,color) VALUES(?,?,?)', [c.name, c.kind, c.color]); });
  return db;
}
export async function loadDb(bytes: Uint8Array): Promise<Db> {
  const eng = await initEngine(); const db = new Db(new eng.Database(bytes));
  if (!db.integrityOk()) { db.close(); throw new Error('Database failed its integrity check'); }
  migrate(db); return db;
}
