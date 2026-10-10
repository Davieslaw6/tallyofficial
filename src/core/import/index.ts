import { ImportError, guardSize, type ParsedStatement } from './types';
import { parseCsv } from './csv';
import { parseOfx } from './ofx';
import { parseQif } from './qif';
import { parsePdf } from './pdf';
export * from './types';
export type FileKind = 'csv' | 'ofx' | 'qif' | 'pdf' | 'xlsx';

export function sniff(name: string, head: Uint8Array): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? ''; const txt = new TextDecoder().decode(head.slice(0, 600));
  if (String.fromCharCode(...head.slice(0, 5)) === '%PDF-') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';
  if (/<OFX>|OFXHEADER/i.test(txt) || ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (/^!Type:/im.test(txt) || ext === 'qif') return 'qif';
  return 'csv';
}
export async function parseAny(name: string, data: Uint8Array, pdfjs?: any): Promise<ParsedStatement> {
  guardSize(data.length); const kind = sniff(name, data);
  switch (kind) {
    case 'pdf': if (!pdfjs) throw new ImportError('PDF engine unavailable'); return parsePdf(data, pdfjs);
    case 'ofx': return parseOfx(data);
    case 'qif': return parseQif(data);
    case 'xlsx': throw new ImportError('Excel files are not read directly in this build. Save the sheet as CSV (File → Save as → CSV) and import that.');
    default: return parseCsv(data);
  }
}
