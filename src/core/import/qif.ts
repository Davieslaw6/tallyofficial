import { parseAmount } from '../money';
import { parseDate } from '../dates';
import { ImportError, guardSize, type ParsedStatement } from './types';

export function parseQif(input: string | Uint8Array): ParsedStatement {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input);
  guardSize(text.length);
  if (!/^!Type:/im.test(text)) throw new ImportError('Not a valid QIF file (missing !Type header)');
  const out: ParsedStatement = { rows: [], format: 'qif', skipped: [], warnings: [] };
  let cur: Record<string, string> = {}; let n = 0; let slashDates: string[] = [];
  const lines = text.split(/\r?\n/);
  const flush = () => {
    n++;
    if (!Object.keys(cur).length) return;
    const date = cur.D ? parseDate(cur.D.replace(/'/g, '/20').replace(/ /g, '')) : null; const amt = cur.T ? parseAmount(cur.T) ?? (cur.U ? parseAmount(cur.U) : null) : null;
    const desc = [cur.P, cur.M].filter(Boolean).join(' — ');
    if (!date || amt === null || !desc) out.skipped.push({ line: n, text: JSON.stringify(cur).slice(0, 120), reason: 'Missing date, amount or payee' });
    else out.rows.push({ date, amount: amt, description: desc, ref: cur.N, line: n, confidence: 1 });
    if (cur.D) slashDates.push(cur.D);
    cur = {};
  };
  for (const l of lines) { if (!l) continue; if (l[0] === '!') continue; if (l[0] === '^') flush(); else cur[l[0]] = l.slice(1).trim(); }
  flush();
  if (!out.rows.length) throw new ImportError('No transactions found in this QIF file');
  return out;
}
