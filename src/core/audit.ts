import type { Db } from './db';
import { sha256Sync } from './sha256';

const GENESIS = '0'.repeat(64);
export type AuditEvent = 'vault.create' | 'vault.unlock' | 'vault.unlock_failed' | 'vault.lock' | 'import' | 'export' | 'backup' | 'restore' | 'schema.migrate' | 'wipe' | 'reconcile' | 'settings';

/** Append-only, hash-chained: each row commits to the previous row, so edits or deletions are detectable. */
export function logEvent(db: Db, event: AuditEvent, detail = '', now = new Date().toISOString()) {
  const prev = db.scalar<string>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1') ?? GENESIS;
  const hash = sha256Sync(`${prev}|${now}|${event}|${detail}`);
  db.run('INSERT INTO audit_log(ts,event,detail,prev_hash,hash) VALUES(?,?,?,?,?)', [now, event, detail, prev, hash]);
}
export interface AuditRow { id: number; ts: string; event: string; detail: string; prev_hash: string; hash: string }
export function readLog(db: Db, limit = 200): AuditRow[] { return db.all<AuditRow>('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]); }
export function verifyChain(db: Db): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const r of db.all<AuditRow>('SELECT * FROM audit_log ORDER BY id ASC')) {
    if (r.prev_hash !== prev || r.hash !== sha256Sync(`${prev}|${r.ts}|${r.event}|${r.detail}`)) return { ok: false, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true };
}
