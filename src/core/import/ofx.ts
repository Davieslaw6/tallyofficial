import { parseAmount } from '../money';
import { parseDate } from '../dates';
import { ImportError, guardSize, type ParsedStatement } from './types';

const tag = (block: string, name: string) => { const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block); return m ? m[1].trim() : ''; };
const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function parseOfx(input: string | Uint8Array): ParsedStatement {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input);
  guardSize(text.length);
  if (/<!DOCTYPE|<!ENTITY/i.test(text.replace(/<!DOCTYPE\s+OFX/i, ''))) throw new ImportError('OFX file contains disallowed entity declarations');
  if (!/<OFX>/i.test(text)) throw new ImportError('Not a valid OFX file');
  const out: ParsedStatement = { rows: [], format: 'ofx', skipped: [], warnings: [] };
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi) ?? [];
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, 'DTPOSTED').slice(0, 8)); const amt = parseAmount(tag(b, 'TRNAMT'));
    const name = unescape(tag(b, 'NAME')), memo = unescape(tag(b, 'MEMO')); const desc = [name, memo].filter(Boolean).join(' — ');
    if (!date || amt === null || !desc) { out.skipped.push({ line: i + 1, text: b.replace(/\s+/g, ' ').slice(0, 120), reason: 'Missing date, amount or description' }); return; }
    out.rows.push({ date, amount: amt, description: desc, ref: tag(b, 'FITID') || undefined, line: i + 1, confidence: 1 });
  });
  const bal = /<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>|<LEDGERBAL>[\s\S]*?(?=<AVAILBAL>|<\/STMTRS>)/i.exec(text);
  if (bal) out.closingBalance = parseAmount(tag(bal[0], 'BALAMT'));
  out.periodStart = parseDate(tag(text, 'DTSTART').slice(0, 8)); out.periodEnd = parseDate(tag(text, 'DTEND').slice(0, 8));
  if (!out.rows.length) throw new ImportError('No transactions found in this OFX file');
  return out;
}
