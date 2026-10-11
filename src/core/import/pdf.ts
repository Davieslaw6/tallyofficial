import { parseAmount } from '../money';
import { parseDate } from '../dates';
import { ImportError, LIMITS, guardSize, type ParsedRow, type ParsedStatement } from './types';

export interface TextItem { str: string; x: number; y: number; w: number; page: number }
interface Cell { text: string; x0: number; x1: number }
interface Line { y: number; page: number; cells: Cell[]; text: string }

/** Pull positioned text out of every page. `pdfjs` is injected so the same code runs in the browser worker and in Node tests. */
export async function extractItems(data: Uint8Array, pdfjs: any): Promise<TextItem[][]> {
  guardSize(data.length);
  if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-') throw new ImportError('This file is not a PDF');
  const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, enableXfa: false, stopAtErrors: false, verbosity: 0 });
  const timer = new Promise<never>((_, rej) => setTimeout(() => { task.destroy?.(); rej(new ImportError('PDF took too long to read and was stopped')); }, LIMITS.timeMs));
  const run = (async () => {
    let doc; try { doc = await task.promise; } catch (e: any) { throw new ImportError(e?.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'This PDF is damaged or unreadable'); }
    if (doc.numPages > LIMITS.maxPdfPages) throw new ImportError(`PDF has ${doc.numPages} pages — the limit is ${LIMITS.maxPdfPages}`);
    const pages: TextItem[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p); const tc = await page.getTextContent(); const items: TextItem[] = [];
      for (const it of tc.items as any[]) if (typeof it.str === 'string' && it.str.trim()) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? it.str.length * 4, page: p });
      pages.push(items);
    }
    await doc.destroy?.();
    return pages;
  })();
  return Promise.race([run, timer]);
}

function toLines(pages: TextItem[][]): Line[] {
  const lines: Line[] = [];
  for (const items of pages) {
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x); let cur: TextItem[] = [];
    const flush = () => {
      if (!cur.length) return; cur.sort((a, b) => a.x - b.x); const cells: Cell[] = [];
      for (const it of cur) {
        const last = cells[cells.length - 1];
        if (last && it.x - last.x1 < 6) { last.text += (it.x - last.x1 > 1.2 ? ' ' : '') + it.str; last.x1 = it.x + it.w; } else cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      }
      cells.forEach((c) => (c.text = c.text.trim()));
      lines.push({ y: cur[0].y, page: cur[0].page, cells, text: cells.map((c) => c.text).join(' ') }); cur = [];
    };
    for (const it of sorted) { if (cur.length && Math.abs(cur[0].y - it.y) > 3) flush(); cur.push(it); }
    flush();
  }
  return lines;
}

const AMOUNT = /^[(\-]?(?:[₦N]\s?)?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?[)\-]?(?:\s?(?:CR|DR|Cr|Dr))?$|^[(\-]?\d+\.\d{2}[)\-]?(?:\s?(?:CR|DR|Cr|Dr))?$/;
const isAmount = (s: string) => AMOUNT.test(s.replace(/\s/g, ' ').trim()) && /\d/.test(s) && (s.includes('.') || s.includes(',') || /(CR|DR)$/i.test(s));
const DATE_AT_START = /^(\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3,9})(?:[-/. ,]+\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})(?=\s|$)/;
/** Header cells are compared after stripping everything but letters, so "Debit (₦)", "DEBIT AMOUNT" and "Money Out" all match. */
const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
const HEADER_WORDS = {
  debit: { test: (t: string) => { const n = norm(t); return n === 'dr' || /^(debit|withdraw|moneyout|paidout|outflow|paymentsout|amountout)/.test(n); } },
  credit: { test: (t: string) => { const n = norm(t); return n === 'cr' || /^(credit|deposit|lodg?e?ment|moneyin|paidin|inflow|receipts|paymentsin|amountin)/.test(n); } },
  balance: { test: (t: string) => /^(balance|runningbalance|closingbalance|bal)$/.test(norm(t)) || /^balance/.test(norm(t)) },
};

/** Last-resort direction clues from the narration when the layout gives no column, marker or running balance. */
const POSITIVE = /\b(salary|payroll|wages|deposit|lodg?e?ment|interest (?:paid|credit)|credit interest|refund|reversal|cashback|dividend|transfer from|trf from|received|inward|credit alert)\b/i;
const NEGATIVE = /\b(pos|wdl|withdrawal|atm|purchase|airtime|vtu|data bundle|bill|charge|fee|levy|stamp duty|vat|commission|subscription|transfer to|trf to|payment|debit|rent|maintenance|sms alert)\b/i;
function cueDirection(desc: string): -1 | 0 | 1 { const p = POSITIVE.test(desc), n = NEGATIVE.test(desc); return p && !n ? 1 : n && !p ? -1 : p && n ? (/transfer from|trf from|salary|refund|reversal/i.test(desc) ? 1 : -1) : 0; }

/** If the statement's opening and closing balances are known, find the (unique, smallest) set of guessed rows whose
 *  direction must be flipped for opening + rows = closing. Returns indexes to flip, or null when it cannot be decided. */
export function solveDirections(rows: { amount: number }[], guessed: number[], opening: number, closing: number): number[] | null {
  const D = closing - opening - rows.reduce((s, r) => s + r.amount, 0); if (D === 0) return [];
  if (D % 2 !== 0 || guessed.length === 0 || guessed.length > 24) return null;
  const target = -D / 2; const vals = guessed.map((i) => rows[i].amount); const h = guessed.length >> 1;
  const halves = [vals.slice(0, h), vals.slice(h)]; const sums = (a: number[]) => { const r: [number, number][] = [[0, 0]]; a.forEach((v, i) => { const n = r.length; for (let k = 0; k < n; k++) r.push([r[k][0] + v, r[k][1] | (1 << i)]); }); return r; };
  const left = sums(halves[0]), right = new Map<number, number[]>(); for (const [sm, mask] of sums(halves[1])) (right.get(sm) ?? right.set(sm, []).get(sm)!).push(mask);
  let best: number[] | null = null, bestN = 99, ties = 0;
  for (const [sm, lm] of left) for (const rm of right.get(target - sm) ?? []) {
    const idx = [...halves[0].map((_, i) => (lm >> i) & 1 ? guessed[i] : -1), ...halves[1].map((_, i) => (rm >> i) & 1 ? guessed[h + i] : -1)].filter((x) => x >= 0);
    if (idx.length < bestN) { best = idx; bestN = idx.length; ties = 1; } else if (idx.length === bestN) ties++;
  }
  return best && ties === 1 ? best : null;
}

function loosDate(s: string, year: number | null, dayFirst = true): string | null {
  const direct = parseDate(s, dayFirst); if (direct) return direct;
  if (year) { const m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})$/.exec(s.trim()); if (m) return parseDate(`${m[1]} ${m[2]} ${year}`); const n = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s.trim()); if (n) return parseDate(`${n[1]}/${n[2]}/${year}`, dayFirst); }
  return null;
}
const sanitize = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export function parseStatementItems(pages: TextItem[][]): ParsedStatement {
  const lines = toLines(pages);
  if (!lines.length) throw new ImportError('No text found in this PDF. It may be a scanned image — OCR is not bundled in this build.');
  const out: ParsedStatement = { rows: [], format: 'pdf', skipped: [], warnings: [] };
  const full = lines.map((l) => l.text).join('\n');
  const per = /(\d{1,2}[-/. ][A-Za-z]{3,9}[-/. ,]*\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(?:to|-|–|through|until)\s*(\d{1,2}[-/. ][A-Za-z]{3,9}[-/. ,]*\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(full);
  if (per) { out.periodStart = parseDate(per[1]); out.periodEnd = parseDate(per[2]); }
  const year = out.periodEnd ? Number(out.periodEnd.slice(0, 4)) : (/\b(20\d{2})\b/.exec(full)?.[1] ? Number(/\b(20\d{2})\b/.exec(full)![1]) : null);

  // column anchors from the table header row
  let cols: { kind: 'debit' | 'credit' | 'balance'; c: number; r: number }[] = [];
  let prevBal: number | null = null; let descX: number | null = null; let last: ParsedRow | null = null; let seq = 0;
  let balanceVerified = 0, balanceMismatch = 0; const guessed: number[] = [];

  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li]; const t = ln.text;
    const hdr = ln.cells.filter((c) => HEADER_WORDS.debit.test(c.text) || HEADER_WORDS.credit.test(c.text) || HEADER_WORDS.balance.test(c.text));
    if (hdr.length >= 2 && !ln.cells.some((c) => isAmount(c.text))) {
      cols = hdr.map((c) => ({ kind: HEADER_WORDS.debit.test(c.text) ? 'debit' as const : HEADER_WORDS.credit.test(c.text) ? 'credit' as const : 'balance' as const, c: (c.x0 + c.x1) / 2, r: c.x1 }));
      const d = ln.cells.find((c) => /desc|narrat|detail|particular|remark/i.test(c.text)); if (d) descX = d.x0; last = null; continue;
    }
    const ob = /(opening balance|balance (?:brought|b)\/?f(?:orward)?|b\/f|previous balance|balance b\/f)/i.test(t), cb = /(closing balance|balance (?:carried|c)\/?f(?:orward)?|c\/f|ending balance|new balance)/i.test(t);
    if ((ob || cb) && !DATE_AT_START.test(ln.cells[0]?.text ?? '')) {
      const amts = ln.cells.filter((c) => isAmount(c.text)); const a = amts.length ? parseAmount(amts[amts.length - 1].text) : null;
      if (a !== null) { if (ob && out.openingBalance == null) { out.openingBalance = a; prevBal = a; } if (cb) out.closingBalance = a; }
      continue;
    }
    const first = ln.cells[0]; const dm = first ? DATE_AT_START.exec(first.text) : null;
    const date = dm ? loosDate(dm[1], year) : null;
    if (!date) {
      // continuation of previous description (wrapped narration), only if line holds no amounts
      if (last && ln.page === last.page && !ln.cells.some((c) => isAmount(c.text)) && !/page \d|statement|account (?:no|number)|total|summary|continued|www\.|customer/i.test(t) && ln.cells.length <= 2 && t.length < 80) {
        last.description = sanitize(`${last.description} ${t}`);
      } else if (dm || ln.cells.some((c) => isAmount(c.text))) out.skipped.push({ line: li + 1, text: t.slice(0, 120), reason: dm ? 'Date could not be read' : 'Amount with no date' });
      continue;
    }
    let cells = ln.cells.slice(); let rest = first.text.slice(dm![0].length).trim(); cells.shift();
    if (rest) cells.unshift({ text: rest, x0: first.x0 + 40, x1: first.x1 });
    if (cells[0] && DATE_AT_START.test(cells[0].text) && loosDate(DATE_AT_START.exec(cells[0].text)![1], year) && !isAmount(cells[0].text) && cells[0].text.length < 14) cells.shift(); // value date
    const nums = cells.filter((c) => isAmount(c.text)); const isTypeCell = (c: Cell) => /^(debit|dr|d|credit|cr|c)$/i.test(c.text.trim());
    const typeCell = cells.find((c) => !isAmount(c.text) && isTypeCell(c)); const textCells = cells.filter((c) => !isAmount(c.text) && !isTypeCell(c));
    let desc = sanitize(textCells.map((c) => c.text).join(' ')); if (!nums.length || !desc) { out.skipped.push({ line: li + 1, text: t.slice(0, 120), reason: !nums.length ? 'No amount found' : 'No description' }); continue; }

    let amount: number | null = null, balance: number | null = null; const warnings: string[] = []; let conf = 0.9;
    const assign = (cell: Cell) => cols.length ? cols.map((k) => ({ k, d: Math.min(Math.abs((cell.x0 + cell.x1) / 2 - k.c), Math.abs(cell.x1 - k.r)) })).sort((a, b) => a.d - b.d)[0] : null;
    if (cols.length) {
      let dr = 0, cr = 0;
      for (const n of nums) { const a = assign(n)!; const v = parseAmount(n.text); if (v === null) continue; if (a.k.kind === 'debit') dr += Math.abs(v); else if (a.k.kind === 'credit') cr += Math.abs(v); else balance = v; }
      if (dr || cr) amount = cr - dr; else if (balance !== null && nums.length === 1) amount = null;
    } else if (nums.length >= 2) { balance = parseAmount(nums[nums.length - 1].text); amount = parseAmount(nums[nums.length - 2].text); }
    else amount = parseAmount(nums[0].text);
    if (amount === null && balance !== null && prevBal !== null) amount = balance - prevBal; // only a balance printed
    if (amount === null) { out.skipped.push({ line: li + 1, text: t.slice(0, 120), reason: 'Amount column unclear' }); continue; }

    const marker = typeCell ? (/^(debit|dr|d)$/i.test(typeCell.text.trim()) ? -1 : 1) : nums.map((n) => /DR$/i.test(n.text.trim()) ? -1 : /CR$/i.test(n.text.trim()) ? 1 : 0).find((m) => m !== 0);
    if (!cols.length) {
      // Direction, in order of trust: running balance → explicit sign / DR-CR marker / Type column → narration clues → assume money out.
      let decided = false;
      if (balance !== null && prevBal !== null) { const up: boolean = prevBal + Math.abs(amount) === balance, down: boolean = prevBal - Math.abs(amount) === balance; if (up !== down) { amount = (up ? 1 : -1) * Math.abs(amount); decided = true; } }
      if (!decided && marker) { amount = marker * Math.abs(amount); decided = true; }
      if (!decided && amount < 0) decided = true; // the statement printed an explicit minus or brackets
      if (!decided) {
        const cue = cueDirection(desc); amount = (cue || -1) * Math.abs(amount); guessed.push(out.rows.length);
        warnings.push(cue ? 'Direction inferred from the description' : 'Direction unknown, assumed money out'); conf = cue ? 0.6 : 0.5;
      }
    }
    if (balance !== null && prevBal !== null) {
      if (prevBal + amount === balance) { balanceVerified++; conf = 0.97; }
      else if (prevBal - amount === balance && amount !== 0) { amount = -amount; balanceVerified++; conf = 0.9; warnings.push('Sign corrected from running balance'); }
      else { balanceMismatch++; conf = Math.min(conf, 0.5); warnings.push('Running balance does not follow from the previous row'); }
    }
    if (balance !== null) prevBal = balance;
    else if (prevBal !== null) prevBal += amount;
    if (balance === null && conf > 0.85) conf = 0.8;
    last = { date, amount, description: desc, balance, page: ln.page, line: ++seq, confidence: Number(conf.toFixed(2)), warnings: warnings.length ? warnings : undefined };
    if (out.rows.length >= LIMITS.maxRows) throw new ImportError('Too many transactions');
    out.rows.push(last); void descX;
  }
  if (!out.rows.length) throw new ImportError('No transactions could be read. This layout may need a bank template or a CSV export.');
  if (out.openingBalance == null) { const f = out.rows[0]; if (f.balance != null) out.openingBalance = f.balance - f.amount; }
  if (out.closingBalance == null) { const l = [...out.rows].reverse().find((r) => r.balance != null); if (l) out.closingBalance = l.balance; }
  if (guessed.length) {
    // No column or marker told us the direction for these rows. If the statement's opening and closing balances are known,
    // they can confirm or correct the guesses: opening + every signed row must equal closing.
    const flip = out.openingBalance != null && out.closingBalance != null ? solveDirections(out.rows, guessed, out.openingBalance, out.closingBalance) : null;
    if (flip) {
      for (const i of flip) out.rows[i].amount = -out.rows[i].amount;
      for (const i of guessed) { const r = out.rows[i]; r.confidence = 0.9; r.warnings = flip.includes(i) ? ['Direction corrected using the statement balances'] : undefined; } // confirmed rows need no flag
      out.warnings.push(`${guessed.length} row(s) did not state money in or out; the direction was worked out from the opening and closing balances${flip.length ? ` (${flip.length} corrected)` : ''}.`);
    } else out.warnings.push(`${guessed.length} row(s) did not state money in or out and could not be confirmed against the statement balances. Directions were guessed from the descriptions, so check them (use Flip in the review).`);
  }
  if (balanceMismatch) out.warnings.push(`${balanceMismatch} row(s) do not follow the running balance — review the flagged lines.`);
  if (!balanceVerified && !cols.length) out.warnings.push('No running balance was found, so amounts could not be cross-checked.');
  return out;
}

export async function parsePdf(data: Uint8Array, pdfjs: any): Promise<ParsedStatement> { return parseStatementItems(await extractItems(data, pdfjs)); }
