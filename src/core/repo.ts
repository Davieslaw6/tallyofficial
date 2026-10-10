import type { Db } from './db';
import { sha256Sync } from './sha256';
import { validIso, addDays, addMonths, monthRange } from './dates';
import { normalizeMerchant } from './categorize';

export interface Account { id: number; name: string; kind: string; opening_balance: number; opening_date: string | null; archived: number }
export interface Category { id: number; name: string; kind: 'income' | 'expense' | 'transfer'; color: string | null }
export interface Tx {
  id: number; account_id: number; date: string; amount: number; description: string; merchant: string; category_id: number | null;
  tags: string; notes: string; transfer_group: string | null; is_split: number; source: string; confidence: number | null; statement_id: number | null; recurring_id: number | null; attachment_hash: string | null;
}
export interface NewTx {
  account_id: number; date: string; amount: number; description: string; category_id?: number | null; tags?: string; notes?: string;
  source?: string; confidence?: number | null; statement_id?: number | null; recurring_id?: number | null; import_hash?: string | null;
}
export class RepoError extends Error {}

const MAX_DESC = 500;
export function validateTx(t: NewTx) {
  if (!Number.isInteger(t.amount)) throw new RepoError('Amount must be a whole number of kobo');
  if (Math.abs(t.amount) > 1e15) throw new RepoError('Amount is too large');
  if (!validIso(t.date)) throw new RepoError(`Invalid date "${t.date}"`);
  if (!t.description?.trim()) throw new RepoError('Description is required');
}
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DESC);

export const importHash = (accountId: number, date: string, amount: number, desc: string, occurrence = 0) =>
  sha256Sync(`${accountId}|${date}|${amount}|${normalizeMerchant(desc) || desc.toLowerCase()}|${occurrence}`);

export class Repo {
  constructor(public db: Db) {}

  // ---- accounts & categories
  accounts(): Account[] { return this.db.all<Account>('SELECT * FROM accounts WHERE archived=0 ORDER BY id'); }
  addAccount(name: string, kind: string, openingBalance = 0, openingDate: string | null = null): number {
    if (!name.trim()) throw new RepoError('Account name is required');
    return this.db.run('INSERT INTO accounts(name,kind,opening_balance,opening_date) VALUES(?,?,?,?)', [clean(name), kind, openingBalance, openingDate]).lastId;
  }
  categories(): Category[] { return this.db.all<Category>('SELECT * FROM categories ORDER BY kind, name'); }
  categoryId(name: string): number | null { return this.db.scalar<number>('SELECT id FROM categories WHERE name=? COLLATE NOCASE', [name]) ?? null; }
  addCategory(name: string, kind: Category['kind'], color: string | null = null): number {
    return this.db.run('INSERT INTO categories(name,kind,color) VALUES(?,?,?)', [clean(name), kind, color]).lastId;
  }
  balance(accountId: number, asOf?: string): number {
    const a = this.db.one<Account>('SELECT * FROM accounts WHERE id=?', [accountId]); if (!a) throw new RepoError('Unknown account');
    const s = this.db.scalar<number>(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=?${asOf ? ' AND date<=?' : ''}`, asOf ? [accountId, asOf] : [accountId]) ?? 0;
    return a.opening_balance + s;
  }

  // ---- transactions
  addTx(t: NewTx): number {
    validateTx(t);
    const acct = this.db.scalar('SELECT id FROM accounts WHERE id=?', [t.account_id]); if (acct === undefined) throw new RepoError('Unknown account');
    const desc = clean(t.description);
    return this.db.run(
      `INSERT INTO transactions(account_id,date,amount,description,merchant,category_id,tags,notes,source,confidence,statement_id,recurring_id,import_hash)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.account_id, t.date, t.amount, desc, normalizeMerchant(desc), t.category_id ?? null, clean(t.tags ?? ''), (t.notes ?? '').slice(0, 2000), t.source ?? 'manual', t.confidence ?? null, t.statement_id ?? null, t.recurring_id ?? null, t.import_hash ?? null]).lastId;
  }
  updateTx(id: number, p: Partial<Pick<NewTx, 'date' | 'amount' | 'description' | 'category_id' | 'tags' | 'notes' | 'account_id'>>) {
    const cur = this.db.one<Tx>('SELECT * FROM transactions WHERE id=?', [id]); if (!cur) throw new RepoError('Transaction not found');
    if (cur.transfer_group && p.amount !== undefined) throw new RepoError('Edit transfers from the transfer dialog so both legs stay in sync');
    const n = { ...cur, ...p } as Tx; validateTx({ account_id: n.account_id, date: n.date, amount: n.amount, description: n.description });
    if (p.amount !== undefined && cur.is_split) this.db.run('DELETE FROM splits WHERE transaction_id=?', [id]), this.db.run('UPDATE transactions SET is_split=0 WHERE id=?', [id]);
    this.db.run('UPDATE transactions SET account_id=?,date=?,amount=?,description=?,merchant=?,category_id=?,tags=?,notes=?,confidence=NULL WHERE id=?',
      [n.account_id, n.date, n.amount, clean(n.description), normalizeMerchant(n.description), n.category_id ?? null, clean(n.tags), n.notes.slice(0, 2000), id]);
  }
  deleteTx(ids: number[]) {
    this.db.tx(() => {
      for (const id of ids) {
        const g = this.db.scalar<string>('SELECT transfer_group FROM transactions WHERE id=?', [id]);
        if (g) this.db.run('DELETE FROM transactions WHERE transfer_group=?', [g]); else this.db.run('DELETE FROM transactions WHERE id=?', [id]);
      }
    });
  }
  setCategory(ids: number[], categoryId: number | null) {
    this.db.tx(() => ids.forEach((id) => { this.db.run('UPDATE transactions SET category_id=?, confidence=NULL WHERE id=? AND transfer_group IS NULL', [categoryId, id]); }));
  }
  list(f: { accountId?: number; from?: string; to?: string; categoryId?: number; q?: string; limit?: number; offset?: number } = {}): Tx[] {
    const w: string[] = ['1=1']; const p: (string | number)[] = [];
    if (f.accountId) { w.push('account_id=?'); p.push(f.accountId); }
    if (f.from) { w.push('date>=?'); p.push(f.from); }
    if (f.to) { w.push('date<=?'); p.push(f.to); }
    if (f.categoryId) { w.push('category_id=?'); p.push(f.categoryId); }
    if (f.q) { w.push('(description LIKE ? ESCAPE \'\\\' OR notes LIKE ? ESCAPE \'\\\' OR tags LIKE ? ESCAPE \'\\\')'); const l = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l, l); }
    return this.db.all<Tx>(`SELECT * FROM transactions WHERE ${w.join(' AND ')} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`, [...p, f.limit ?? 100000, f.offset ?? 0]);
  }
  count(): number { return this.db.scalar<number>('SELECT COUNT(*) FROM transactions') ?? 0; }

  // ---- receipts: stored inside the encrypted database and referenced by content hash
  static MAX_ATTACHMENT = 3 * 1024 * 1024;
  attach(txId: number, name: string, mime: string, data: Uint8Array): string {
    if (data.length > Repo.MAX_ATTACHMENT) throw new RepoError('Receipts can be up to 3 MB');
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(mime)) throw new RepoError('Attach a PNG, JPEG, WebP, GIF or PDF');
    const hash = sha256Sync(data);
    this.db.tx(() => { this.db.run('INSERT OR IGNORE INTO attachments(hash,name,mime,size,data) VALUES(?,?,?,?,?)', [hash, clean(name).slice(0, 120), mime, data.length, data]); this.db.run('UPDATE transactions SET attachment_hash=? WHERE id=?', [hash, txId]); });
    return hash;
  }
  attachment(hash: string) { return this.db.one<{ name: string; mime: string; size: number; data: Uint8Array }>('SELECT name,mime,size,data FROM attachments WHERE hash=?', [hash]); }
  detach(txId: number) { this.db.run('UPDATE transactions SET attachment_hash=NULL WHERE id=?', [txId]); this.db.run('DELETE FROM attachments WHERE hash NOT IN (SELECT attachment_hash FROM transactions WHERE attachment_hash IS NOT NULL)'); }

  // ---- splits: parts must add up exactly to the parent amount
  setSplits(txId: number, parts: { category_id: number | null; amount: number; note?: string }[]) {
    const tx = this.db.one<Tx>('SELECT * FROM transactions WHERE id=?', [txId]); if (!tx) throw new RepoError('Transaction not found');
    if (tx.transfer_group) throw new RepoError('Transfers cannot be split');
    if (parts.length < 2) throw new RepoError('A split needs at least two parts');
    const sum = parts.reduce((a, b) => a + b.amount, 0);
    if (sum !== tx.amount) throw new RepoError(`Parts add up to ${(sum / 100).toFixed(2)} but the transaction is ${(tx.amount / 100).toFixed(2)} — ${((tx.amount - sum) / 100).toFixed(2)} left to assign`);
    if (parts.some((p) => Math.sign(p.amount) !== Math.sign(tx.amount) && p.amount !== 0)) throw new RepoError('Every part must have the same direction as the transaction');
    this.db.tx(() => {
      this.db.run('DELETE FROM splits WHERE transaction_id=?', [txId]);
      for (const p of parts) this.db.run('INSERT INTO splits(transaction_id,category_id,amount,note) VALUES(?,?,?,?)', [txId, p.category_id, p.amount, clean(p.note ?? '')]);
      this.db.run('UPDATE transactions SET is_split=1 WHERE id=?', [txId]);
    });
  }
  splits(txId: number) { return this.db.all<{ id: number; category_id: number | null; amount: number; note: string }>('SELECT * FROM splits WHERE transaction_id=?', [txId]); }

  // ---- transfers: two legs, excluded from income/expense
  addTransfer(from: number, to: number, amount: number, date: string, note = ''): string {
    if (from === to) throw new RepoError('Pick two different accounts');
    if (!Number.isInteger(amount) || amount <= 0) throw new RepoError('Transfer amount must be positive');
    const group = crypto.randomUUID(); const cat = this.categoryId('Transfer');
    const fromName = this.db.scalar<string>('SELECT name FROM accounts WHERE id=?', [from]), toName = this.db.scalar<string>('SELECT name FROM accounts WHERE id=?', [to]);
    if (!fromName || !toName) throw new RepoError('Unknown account');
    this.db.tx(() => {
      for (const [acct, amt, d] of [[from, -amount, `Transfer to ${toName}`], [to, amount, `Transfer from ${fromName}`]] as const) {
        const id = this.addTx({ account_id: acct, date, amount: amt, description: note ? `${d} — ${note}` : d, category_id: cat });
        this.db.run('UPDATE transactions SET transfer_group=? WHERE id=?', [group, id]);
      }
    });
    return group;
  }

  // ---- reporting. Transfers are excluded; splits are counted by their own categories.
  private spendRows(from: string, to: string) {
    return `SELECT x.category_id AS category_id, x.amount AS amount, x.date AS date FROM (
      SELECT t.category_id, t.amount, t.date FROM transactions t WHERE t.is_split=0 AND t.transfer_group IS NULL AND t.date BETWEEN '${from}' AND '${to}'
      UNION ALL
      SELECT s.category_id, s.amount, t.date FROM splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.transfer_group IS NULL AND t.date BETWEEN '${from}' AND '${to}') x`;
  }
  incomeExpense(from: string, to: string) {
    if (!validIso(from) || !validIso(to)) throw new RepoError('Invalid range');
    const r = this.db.one<{ i: number; e: number }>(`SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount END),0) AS i, COALESCE(SUM(CASE WHEN amount<0 THEN -amount END),0) AS e FROM (${this.spendRows(from, to)})`)!;
    return { income: r.i, expense: r.e, net: r.i - r.e };
  }
  byCategory(from: string, to: string) {
    if (!validIso(from) || !validIso(to)) throw new RepoError('Invalid range');
    return this.db.all<{ category_id: number | null; name: string; color: string | null; total: number }>(
      `SELECT x.category_id, COALESCE(c.name,'Uncategorized') AS name, c.color, SUM(-x.amount) AS total FROM (${this.spendRows(from, to)}) x LEFT JOIN categories c ON c.id=x.category_id WHERE x.amount<0 GROUP BY x.category_id ORDER BY total DESC`);
  }
  monthlySeries(months: string[]) { return months.map((m) => { const [a, b] = monthRange(m); return { month: m, ...this.incomeExpense(a, b) }; }); }
  netWorthSeries(months: string[]) {
    return months.map((m) => { const end = monthRange(m)[1]; return { month: m, value: this.accounts().reduce((s, a) => s + this.balance(a.id, end), 0) }; });
  }

  // ---- merchant rules & model persistence
  rules() { return this.db.all<{ pattern: string; category_id: number }>('SELECT pattern, category_id FROM merchant_rules ORDER BY LENGTH(pattern) DESC'); }
  saveRule(pattern: string, categoryId: number) { this.db.run('INSERT INTO merchant_rules(pattern,category_id) VALUES(?,?) ON CONFLICT(profile_id,pattern) DO UPDATE SET category_id=excluded.category_id', [pattern, categoryId]); }
  loadModel(): string | undefined { return this.db.scalar<string>('SELECT json FROM model_state WHERE profile_id=1'); }
  saveModel(json: string) { this.db.run('INSERT INTO model_state(profile_id,json) VALUES(1,?) ON CONFLICT(profile_id) DO UPDATE SET json=excluded.json', [json]); }

  // ---- budgets, goals, recurring
  budgets() { return this.db.all<{ id: number; category_id: number; monthly_limit: number; alert_at: number }>('SELECT * FROM budgets'); }
  setBudget(categoryId: number, limit: number, alertAt = 0.8) {
    if (!Number.isInteger(limit) || limit <= 0) throw new RepoError('Budget must be greater than zero');
    this.db.run('INSERT INTO budgets(category_id,monthly_limit,alert_at) VALUES(?,?,?) ON CONFLICT(profile_id,category_id) DO UPDATE SET monthly_limit=excluded.monthly_limit, alert_at=excluded.alert_at', [categoryId, limit, alertAt]);
  }
  deleteBudget(categoryId: number) { this.db.run('DELETE FROM budgets WHERE category_id=?', [categoryId]); }
  goals() { return this.db.all<{ id: number; name: string; target_amount: number; target_date: string | null; saved: number }>('SELECT * FROM goals'); }
  addGoal(name: string, target: number, targetDate: string | null, saved = 0) {
    if (target <= 0) throw new RepoError('Target must be greater than zero'); if (targetDate && !validIso(targetDate)) throw new RepoError('Invalid target date');
    return this.db.run('INSERT INTO goals(name,target_amount,target_date,saved) VALUES(?,?,?,?)', [clean(name), target, targetDate, saved]).lastId;
  }
  contributeGoal(id: number, amount: number) { this.db.run('UPDATE goals SET saved=MAX(0,saved+?) WHERE id=?', [amount, id]); }
  deleteGoal(id: number) { this.db.run('DELETE FROM goals WHERE id=?', [id]); }

  recurring() { return this.db.all<{ id: number; account_id: number; description: string; amount: number; category_id: number | null; frequency: string; next_due: string; active: number }>('SELECT * FROM recurring WHERE active=1 ORDER BY next_due'); }
  addRecurring(r: { account_id: number; description: string; amount: number; category_id: number | null; frequency: string; next_due: string }) {
    validateTx({ account_id: r.account_id, date: r.next_due, amount: r.amount, description: r.description });
    return this.db.run('INSERT INTO recurring(account_id,description,amount,category_id,frequency,next_due) VALUES(?,?,?,?,?,?)', [r.account_id, clean(r.description), r.amount, r.category_id, r.frequency, r.next_due]).lastId;
  }
  deleteRecurring(id: number) { this.db.run('UPDATE recurring SET active=0 WHERE id=?', [id]); }
  /** Items due on or before `today`. Caller asks the user to confirm before generating. */
  dueRecurring(today: string) { return this.recurring().filter((r) => r.next_due <= today); }
  /** Generate every missed occurrence up to `today`, idempotently (hash on recurring id + date). */
  generateRecurring(id: number, today: string): number {
    const r = this.db.one<{ id: number; account_id: number; description: string; amount: number; category_id: number | null; frequency: string; next_due: string }>('SELECT * FROM recurring WHERE id=? AND active=1', [id]);
    if (!r) return 0; let n = 0, d = r.next_due;
    this.db.tx(() => {
      while (d <= today && n < 500) {
        const h = sha256Sync(`rec|${r.id}|${d}`);
        if (this.db.scalar('SELECT 1 FROM transactions WHERE import_hash=?', [h]) === undefined) {
          this.addTx({ account_id: r.account_id, date: d, amount: r.amount, description: r.description, category_id: r.category_id, source: 'recurring', recurring_id: r.id, import_hash: h }); n++;
        }
        d = nextDue(d, r.frequency);
      }
      this.db.run('UPDATE recurring SET next_due=? WHERE id=?', [d, r.id]);
    });
    return n;
  }
}
export function nextDue(d: string, freq: string): string {
  switch (freq) { case 'weekly': return addDays(d, 7); case 'biweekly': return addDays(d, 14); case 'monthly': return addMonths(d, 1); case 'quarterly': return addMonths(d, 3); default: return addMonths(d, 12); }
}
