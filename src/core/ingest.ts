import type { Repo } from './repo';
import { importHash } from './repo';
import { Categorizer, normalizeMerchant } from './categorize';
import { diffDays } from './dates';
import { sha256Sync } from './sha256';
import type { ParsedRow, ParsedStatement } from './import/types';
import { logEvent } from './audit';
import baseline from './baseline-model.json';

export type DupState = 'none' | 'exact' | 'possible';
export interface ReviewRow { key: number; row: ParsedRow; categoryId: number | null; suggestedId: number | null; confidence: number; via: string; dup: DupState; dupOf?: number; accept: boolean; remember: boolean; hash: string }

const jaccard = (a: string, b: string) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };

export function prepareReview(repo: Repo, parsed: ParsedStatement, accountId: number, cat: Categorizer): ReviewRow[] {
  const seen = new Map<string, number>();
  return parsed.rows.map((row, key) => {
    const base = importHash(accountId, row.date, row.amount, row.description, 0);
    const occ = seen.get(base) ?? 0; seen.set(base, occ + 1);
    const hash = importHash(accountId, row.date, row.amount, row.description, occ);
    const s = cat.suggest(row.description, row.amount);
    let dup: DupState = 'none', dupOf: number | undefined;
    const exact = repo.db.one<{ id: number }>('SELECT id FROM transactions WHERE account_id=? AND import_hash=?', [accountId, hash]);
    if (exact) { dup = 'exact'; dupOf = exact.id; }
    else {
      const near = repo.db.all<{ id: number; date: string; description: string }>('SELECT id,date,description FROM transactions WHERE account_id=? AND amount=? AND date BETWEEN date(?, \'-3 day\') AND date(?, \'+3 day\')', [accountId, row.amount, row.date, row.date]);
      const m = near.find((n) => Math.abs(diffDays(n.date, row.date)) <= 3 && jaccard(normalizeMerchant(n.description), normalizeMerchant(row.description)) >= 0.5);
      if (m) { dup = 'possible'; dupOf = m.id; }
    }
    return { key, row, categoryId: s.categoryId, suggestedId: s.categoryId, confidence: Math.min(row.confidence, s.confidence), via: s.via, dup, dupOf, accept: dup === 'none', remember: false, hash };
  });
}

export class AlreadyImported extends Error {}

export function commitReview(repo: Repo, accountId: number, rows: ReviewRow[], cat: Categorizer, meta: { fileBytes: Uint8Array; format: string; parsed: ParsedStatement }) {
  const fileHash = sha256Sync(meta.fileBytes);
  if (repo.db.scalar('SELECT 1 FROM statements WHERE account_id=? AND file_hash=?', [accountId, fileHash]) !== undefined) throw new AlreadyImported('This exact file was already imported into this account.');
  let added = 0;
  repo.db.tx(() => {
    const sid = repo.db.run('INSERT INTO statements(account_id,file_hash,period_start,period_end,opening_balance,closing_balance) VALUES(?,?,?,?,?,?)',
      [accountId, fileHash, meta.parsed.periodStart ?? null, meta.parsed.periodEnd ?? null, meta.parsed.openingBalance ?? null, meta.parsed.closingBalance ?? null]).lastId;
    for (const r of rows) {
      if (!r.accept) continue;
      repo.addTx({ account_id: accountId, date: r.row.date, amount: r.row.amount, description: r.row.description, category_id: r.categoryId, source: meta.format, confidence: r.confidence, statement_id: sid, import_hash: r.hash });
      added++;
      if (r.categoryId !== null && r.categoryId !== r.suggestedId) { const pat = cat.learn(r.row.description, r.row.amount, r.categoryId, r.remember); if (pat) repo.saveRule(pat, r.categoryId); }
    }
    repo.saveModel(JSON.stringify(cat.model));
    logEvent(repo.db, 'import', `${meta.format} rows=${added}/${rows.length} sha=${fileHash.slice(0, 12)}`);
  });
  return { added, skipped: rows.length - added };
}

export function makeCategorizer(repo: Repo): Categorizer {
  const raw = repo.loadModel();
  // New profiles start from the bundled baseline (trained offline on synthetic data); user corrections then adapt it.
  return new Categorizer(repo.categories(), repo.rules(), raw ? JSON.parse(raw) : structuredClone(baseline) as never);
}
/** Learn from a correction made outside import (editing a transaction in the table). */
export function learnCorrection(repo: Repo, cat: Categorizer, txId: number, categoryId: number, remember: boolean) {
  const t = repo.db.one<{ description: string; amount: number }>('SELECT description, amount FROM transactions WHERE id=?', [txId]); if (!t) return;
  const pat = cat.learn(t.description, t.amount, categoryId, remember); if (pat) repo.saveRule(pat, categoryId); repo.saveModel(JSON.stringify(cat.model));
}
