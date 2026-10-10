import { parseAmount } from '../money';
import { parseDate } from '../dates';
import { ImportError, LIMITS, guardSize, type ParsedRow, type ParsedStatement } from './types';

export function parseCsvText(text: string, delim?: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delim ?? detectDelimiter(text);
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; if (rows.length > LIMITS.maxRows) throw new ImportError('Too many rows'); }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row); }
  return rows;
}
function detectDelimiter(t: string): string {
  const head = t.slice(0, 4000).split(/\r?\n/).slice(0, 5).join('\n');
  const score = (d: string) => (head.match(new RegExp(d === '\t' ? '\t' : `\\${d}`, 'g')) ?? []).length;
  return [',', ';', '\t', '|'].map((d) => [d, score(d)] as const).sort((a, b) => b[1] - a[1])[0][0];
}

const H = {
  date: /^(date|trans(action)?\s*date|value\s*date|posted|posting\s*date|txn\s*date)/i,
  desc: /(desc|narrat|detail|remark|particular|memo|payee|reference)/i,
  debit: /(debit|withdraw|money\s*out|paid\s*out|dr\b)/i,
  credit: /(credit|deposit|money\s*in|paid\s*in|cr\b)/i,
  amount: /^(amount|value|trans(action)?\s*amount)$/i,
  balance: /(balance|bal\b)/i,
};
export interface CsvMapping { date: number; desc: number; debit?: number; credit?: number; amount?: number; balance?: number }

export function guessMapping(header: string[]): CsvMapping | null {
  const find = (re: RegExp, skip: number[] = []) => header.findIndex((h, i) => !skip.includes(i) && re.test(h.trim()));
  const date = find(H.date); if (date < 0) return null;
  const balance = find(H.balance); const debit = find(H.debit), credit = find(H.credit), amount = find(H.amount);
  const desc = find(H.desc, [date, balance, debit, credit, amount]);
  if (desc < 0 || (amount < 0 && (debit < 0 && credit < 0))) return null;
  return { date, desc, debit: debit >= 0 ? debit : undefined, credit: credit >= 0 ? credit : undefined, amount: amount >= 0 ? amount : undefined, balance: balance >= 0 ? balance : undefined };
}

export function parseCsv(input: string | Uint8Array, opts: { mapping?: CsvMapping; dayFirst?: boolean } = {}): ParsedStatement {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input);
  guardSize(text.length);
  const rows = parseCsvText(text);
  if (rows.length < 2) throw new ImportError('The file has no data rows');
  let hi = rows.findIndex((r) => guessMapping(r)); if (opts.mapping) hi = 0;
  if (hi < 0) throw new ImportError('Could not find date, description and amount columns. Map them manually.');
  const map = opts.mapping ?? guessMapping(rows[hi])!;
  const out: ParsedStatement = { rows: [], format: 'csv', skipped: [], warnings: [] };
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; const dateRaw = (r[map.date] ?? '').trim();
    const date = parseDate(dateRaw, opts.dayFirst ?? true);
    let amt: number | null = null;
    if (map.amount !== undefined) amt = parseAmount(r[map.amount] ?? '');
    else {
      const dr = map.debit !== undefined ? parseAmount(r[map.debit] ?? '') : null, cr = map.credit !== undefined ? parseAmount(r[map.credit] ?? '') : null;
      if (dr || cr) amt = (cr ?? 0) - Math.abs(dr ?? 0);
    }
    const desc = (r[map.desc] ?? '').trim();
    if (!date || amt === null || !desc) { out.skipped.push({ line: i + 1, text: r.join(' | ').slice(0, 120), reason: !date ? 'No valid date' : amt === null ? 'No amount' : 'No description' }); continue; }
    out.rows.push({ date, amount: amt, description: desc, balance: map.balance !== undefined ? parseAmount(r[map.balance] ?? '') : null, line: i + 1, confidence: 1 });
  }
  if (!out.rows.length) throw new ImportError('No transactions could be read from this file');
  return out;
}

/** CSV export; cells that start with = + - @ are prefixed to neutralise spreadsheet formula injection. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => { let s = String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
