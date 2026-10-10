import type { Repo, Tx } from './repo';
import { diffDays, addDays, monthRange, shiftMonth, monthKey } from './dates';
import { normalizeMerchant } from './categorize';
import { nextDue } from './repo';

// ---------- anomalies & duplicates
const jacc = (a: string, b: string) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };
export interface Flag { kind: 'duplicate' | 'outlier' | 'gap'; txIds: number[]; message: string; severity: 'info' | 'warn' }

export function findDuplicates(txs: Tx[]): Flag[] {
  const flags: Flag[] = []; const byAmt = new Map<string, Tx[]>();
  for (const t of txs) if (!t.transfer_group) { const k = `${t.account_id}|${t.amount}`; (byAmt.get(k) ?? byAmt.set(k, []).get(k)!).push(t); }
  for (const g of byAmt.values()) {
    g.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length && diffDays(g[j].date, g[i].date) <= 2; j++)
      if (jacc(normalizeMerchant(g[i].description), normalizeMerchant(g[j].description)) >= 0.7) flags.push({ kind: 'duplicate', txIds: [g[i].id, g[j].id], severity: 'warn', message: `"${g[i].description}" appears twice (${g[i].date}, ${g[j].date}) for the same amount` });
  }
  return flags;
}
const quantile = (s: number[], q: number) => { const p = (s.length - 1) * q, lo = Math.floor(p); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo); };
export function findOutliers(txs: Tx[], minSamples = 8): Flag[] {
  const flags: Flag[] = []; const by = new Map<number, Tx[]>();
  for (const t of txs) if (t.amount < 0 && !t.transfer_group && t.category_id) (by.get(t.category_id) ?? by.set(t.category_id, []).get(t.category_id)!).push(t);
  for (const g of by.values()) {
    if (g.length < minSamples) continue; const mags = g.map((t) => -t.amount).sort((a, b) => a - b);
    const mean = mags.reduce((a, b) => a + b, 0) / mags.length, sd = Math.sqrt(mags.reduce((a, b) => a + (b - mean) ** 2, 0) / mags.length);
    const q1 = quantile(mags, 0.25), q3 = quantile(mags, 0.75), fence = q3 + 1.5 * (q3 - q1);
    for (const t of g) { const m = -t.amount, z = sd ? (m - mean) / sd : 0; if (z > 3 && m > fence) flags.push({ kind: 'outlier', txIds: [t.id], severity: 'warn', message: `"${t.description}" on ${t.date} is far larger than your usual spend in this category (z=${z.toFixed(1)})` }); }
  }
  return flags;
}
export function findGaps(txs: Tx[], thresholdDays = 21, minActive = 20): Flag[] {
  const flags: Flag[] = []; const by = new Map<number, string[]>();
  for (const t of txs) (by.get(t.account_id) ?? by.set(t.account_id, []).get(t.account_id)!).push(t.date);
  for (const [acct, ds] of by) { if (ds.length < minActive) continue; const u = [...new Set(ds)].sort(); for (let i = 1; i < u.length; i++) { const d = diffDays(u[i], u[i - 1]); if (d > thresholdDays) flags.push({ kind: 'gap', txIds: [], severity: 'info', message: `No transactions for ${d} days between ${u[i - 1]} and ${u[i]} (account ${acct}) — a statement may be missing` }); } }
  return flags;
}

// ---------- subscriptions
export interface Subscription { merchant: string; amount: number; every: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; last: string; next: string; count: number; categoryId: number | null }
export function detectSubscriptions(txs: Tx[]): Subscription[] {
  const by = new Map<string, Tx[]>();
  for (const t of txs) if (t.amount < 0 && !t.transfer_group && t.merchant) (by.get(t.merchant) ?? by.set(t.merchant, []).get(t.merchant)!).push(t);
  const out: Subscription[] = [];
  for (const [m, g] of by) {
    if (g.length < 3) continue; g.sort((a, b) => a.date.localeCompare(b.date));
    const amts = g.map((t) => -t.amount); const med = amts.slice().sort((a, b) => a - b)[amts.length >> 1];
    if (!amts.every((a) => Math.abs(a - med) <= med * 0.1)) continue;
    const gaps = g.slice(1).map((t, i) => diffDays(t.date, g[i].date)); const gm = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
    const band: [number, number, Subscription['every']][] = [[6, 8, 'weekly'], [27, 33, 'monthly'], [85, 96, 'quarterly'], [355, 375, 'yearly']];
    const hit = band.find(([lo, hi]) => gm >= lo && gm <= hi); if (!hit || !gaps.every((x) => x >= hit[0] - 4 && x <= hit[1] + 4)) continue;
    const last = g[g.length - 1]; out.push({ merchant: m, amount: med, every: hit[2], last: last.date, next: nextDue(last.date, hit[2]), count: g.length, categoryId: last.category_id });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// ---------- budgets & insights
export interface BudgetStatus { categoryId: number; name: string; limit: number; spent: number; ratio: number; state: 'ok' | 'near' | 'over' }
export function budgetStatus(repo: Repo, month: string): BudgetStatus[] {
  const [a, b] = monthRange(month); const spend = new Map(repo.byCategory(a, b).map((r) => [r.category_id, r.total])); const names = new Map(repo.categories().map((c) => [c.id, c.name]));
  return repo.budgets().map((bd) => { const spent = spend.get(bd.category_id) ?? 0, ratio = spent / bd.monthly_limit; return { categoryId: bd.category_id, name: names.get(bd.category_id) ?? '?', limit: bd.monthly_limit, spent, ratio, state: ratio >= 1 ? 'over' as const : ratio >= bd.alert_at ? 'near' as const : 'ok' as const }; }).sort((x, y) => y.ratio - x.ratio);
}
export interface Insight { id: string; tone: 'good' | 'watch' | 'info'; title: string; body: string }
export function insights(repo: Repo, month: string): Insight[] {
  const out: Insight[] = []; const [a, b] = monthRange(month); const prev = [shiftMonth(month, -3), shiftMonth(month, -1)] as const;
  const cur = new Map(repo.byCategory(a, b).map((r) => [r.name, r.total]));
  const hist = new Map<string, number>(); for (let i = 1; i <= 3; i++) { const [x, y] = monthRange(shiftMonth(month, -i)); for (const r of repo.byCategory(x, y)) hist.set(r.name, (hist.get(r.name) ?? 0) + r.total / 3); }
  void prev;
  for (const [name, v] of cur) { const h = hist.get(name); if (h && h > 0 && v > h * 1.3 && v - h > 500000) out.push({ id: `up-${name}`, tone: 'watch', title: `${name} is up ${Math.round((v / h - 1) * 100)}%`, body: `This month ${(v / 100).toLocaleString('en-NG')} versus a 3-month average of ${(h / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 })}.` }); }
  for (const s of budgetStatus(repo, month)) { if (s.state === 'over') out.push({ id: `over-${s.categoryId}`, tone: 'watch', title: `${s.name} is over budget`, body: `Spent ${Math.round(s.ratio * 100)}% of the monthly limit.` }); else if (s.state === 'near') out.push({ id: `near-${s.categoryId}`, tone: 'watch', title: `${s.name} is close to its limit`, body: `${Math.round(s.ratio * 100)}% used.` }); }
  const subs = detectSubscriptions(repo.list({ from: addDays(a, -400), to: b }));
  if (subs.length) { const monthly = subs.reduce((s, x) => s + (x.every === 'weekly' ? x.amount * 4.33 : x.every === 'monthly' ? x.amount : x.every === 'quarterly' ? x.amount / 3 : x.amount / 12), 0); out.push({ id: 'subs', tone: 'info', title: `${subs.length} recurring charge${subs.length > 1 ? 's' : ''} detected`, body: `About ${(monthly / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 })} a month. Cancel anything you no longer use.` }); }
  const fees = cur.get('Bank fees') ?? 0; if (fees > 0) out.push({ id: 'fees', tone: 'info', title: `Bank fees: ${(fees / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 })} this month`, body: 'SMS alerts, stamp duty and transfer fees add up. Check whether a cheaper account tier or fewer alerts would cut this.' });
  const ie = repo.incomeExpense(a, b); if (ie.income > 0 && ie.net / ie.income >= 0.2) out.push({ id: 'save', tone: 'good', title: `You kept ${Math.round((ie.net / ie.income) * 100)}% of income`, body: 'Consider moving the surplus into a goal before it is spent.' });
  return out;
}

// ---------- forecasting
export interface ForecastPoint { date: string; balance: number }
/** Project total balance: recurring items on schedule + trailing 90-day average of other daily movement. */
export function forecast(repo: Repo, today: string, days = 90): ForecastPoint[] {
  const start = repo.accounts().reduce((s, a) => s + repo.balance(a.id), 0);
  const win = repo.list({ from: addDays(today, -90), to: today }).filter((t) => !t.transfer_group && !t.recurring_id);
  const rec = repo.recurring(); const recIds = new Set(rec.map((r) => r.id));
  const baseline = Math.round(win.filter((t) => !t.recurring_id || !recIds.has(t.recurring_id)).reduce((s, t) => s + t.amount, 0) / 90);
  const due = rec.map((r) => ({ ...r })); let bal = start; const out: ForecastPoint[] = [{ date: today, balance: bal }];
  for (let i = 1; i <= days; i++) {
    const d = addDays(today, i); bal += baseline;
    for (const r of due) while (r.next_due <= d) { if (r.next_due > today) bal += r.amount; r.next_due = nextDue(r.next_due, r.frequency); }
    out.push({ date: d, balance: bal });
  }
  return out;
}
export { monthKey };
