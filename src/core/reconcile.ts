import type { Repo, Tx } from './repo';
import { formatMoney } from './money';
import { addDays } from './dates';
import type { ParsedStatement } from './import/types';

export interface ReconResult {
  period: { start: string; end: string }; statementOpening: number; statementClosing: number;
  bookOpening: number; bookClosing: number; periodNet: number; openingDelta: number; closingDelta: number; balanced: boolean;
  matched: Tx[]; unmatchedBook: Tx[]; unmatchedStatement: { date: string; amount: number; description: string }[];
  explanations: string[];
}

/** Compare a statement against the books for one account. Pure read — never mutates data. */
export function reconcile(repo: Repo, accountId: number, st: ParsedStatement | { openingBalance: number; closingBalance: number; periodStart: string; periodEnd: string; rows?: ParsedStatement['rows'] }): ReconResult {
  const start = st.periodStart ?? st.rows?.[0]?.date, end = st.periodEnd ?? st.rows?.[st.rows.length - 1]?.date;
  if (!start || !end) throw new Error('Statement period is unknown — set the start and end dates first.');
  if (st.openingBalance == null || st.closingBalance == null) throw new Error('Statement opening and closing balances are required to reconcile.');
  const bookOpening = repo.balance(accountId, addDays(start, -1)), bookClosing = repo.balance(accountId, end);
  const inPeriod = repo.list({ accountId, from: start, to: end });
  const periodNet = inPeriod.reduce((s, t) => s + t.amount, 0);
  const openingDelta = bookOpening - st.openingBalance;
  const computedClose = st.openingBalance + periodNet;
  const closingDelta = computedClose - st.closingBalance;
  const explanations: string[] = [];
  const unmatchedBook = [...inPeriod]; const matched: Tx[] = []; const unmatchedStatement: ReconResult['unmatchedStatement'] = [];
  for (const r of st.rows ?? []) {
    const i = unmatchedBook.findIndex((t) => t.amount === r.amount && Math.abs(Date.parse(t.date) - Date.parse(r.date)) <= 3 * 86400000);
    if (i >= 0) matched.push(unmatchedBook.splice(i, 1)[0]); else unmatchedStatement.push({ date: r.date, amount: r.amount, description: r.description });
  }
  if (closingDelta !== 0) {
    const d = closingDelta; // positive: books show more than the bank
    if (st.rows) {
      const m = unmatchedStatement.find((r) => r.amount === -d); if (m) explanations.push(`The statement has "${m.description}" (${formatMoney(m.amount)}) on ${m.date} that is not in your books.`);
      const b = unmatchedBook.find((t) => t.amount === d); if (b) explanations.push(`Your books have "${b.description}" (${formatMoney(b.amount)}) on ${b.date} that the statement does not show.`);
    }
    const dup = inPeriod.find((t, i) => t.amount === d && inPeriod.findIndex((o) => o.amount === t.amount && o.date === t.date && o.description === t.description) !== i);
    if (dup) explanations.push(`"${dup.description}" appears twice on ${dup.date}; removing one would close the gap.`);
    const flip = inPeriod.find((t) => Math.abs(t.amount * 2) === Math.abs(d)); if (flip) explanations.push(`"${flip.description}" (${formatMoney(flip.amount)}) may have the wrong sign — flipping it changes the total by ${formatMoney(Math.abs(d))}.`);
    if (!explanations.length) explanations.push(`Books and statement differ by ${formatMoney(Math.abs(d))} with no single transaction that explains it. Look for a missing fee, a pending item, or a typo.`);
  }
  if (openingDelta !== 0) explanations.push(`Your books open this period at ${formatMoney(bookOpening)} but the statement opens at ${formatMoney(st.openingBalance)} (difference ${formatMoney(openingDelta)}). Earlier history or the account's opening balance needs attention.`);
  return { period: { start, end }, statementOpening: st.openingBalance, statementClosing: st.closingBalance, bookOpening, bookClosing, periodNet, openingDelta, closingDelta, balanced: closingDelta === 0 && openingDelta === 0, matched, unmatchedBook, unmatchedStatement, explanations };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Standalone, script-free HTML report (safe to open or print to PDF). */
export function auditReportHtml(accountName: string, r: ReconResult): string {
  const row = (d: string, a: number, t: string) => `<tr><td>${esc(d)}</td><td>${esc(t)}</td><td class="n">${esc(formatMoney(a))}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Audit report — ${esc(accountName)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#14192b}h1{font-size:1.4rem}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}td,th{padding:.35rem .5rem;border-bottom:1px solid #d6d9e6;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}.ok{color:#1e7f5c}.bad{color:#a8204e}</style></head><body>
<h1>${esc(accountName)} · ${esc(r.period.start)} to ${esc(r.period.end)}</h1>
<p class="${r.balanced ? 'ok' : 'bad'}"><strong>${r.balanced ? 'Balanced — books match the statement.' : `Not balanced — difference ${esc(formatMoney(r.closingDelta))}.`}</strong></p>
<table><tr><th></th><th class="n">Statement</th><th class="n">Books</th></tr>
<tr><td>Opening balance</td><td class="n">${esc(formatMoney(r.statementOpening))}</td><td class="n">${esc(formatMoney(r.bookOpening))}</td></tr>
<tr><td>Net movement</td><td class="n">${esc(formatMoney(r.statementClosing - r.statementOpening))}</td><td class="n">${esc(formatMoney(r.periodNet))}</td></tr>
<tr><td>Closing balance</td><td class="n">${esc(formatMoney(r.statementClosing))}</td><td class="n">${esc(formatMoney(r.bookClosing))}</td></tr></table>
<p>${r.matched.length} matched · ${r.unmatchedStatement.length} only on the statement · ${r.unmatchedBook.length} only in your books</p>
${r.explanations.length ? `<h2>What explains the difference</h2><ul>${r.explanations.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
${r.unmatchedStatement.length ? `<h2>Only on the statement</h2><table>${r.unmatchedStatement.map((x) => row(x.date, x.amount, x.description)).join('')}</table>` : ''}
${r.unmatchedBook.length ? `<h2>Only in your books</h2><table>${r.unmatchedBook.map((x) => row(x.date, x.amount, x.description)).join('')}</table>` : ''}
<p style="color:#666;font-size:.85rem">Generated on this device. No data left your computer.</p></body></html>`;
}
