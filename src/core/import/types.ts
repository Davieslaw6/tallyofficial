export interface ParsedRow {
  date: string; amount: number; description: string; balance?: number | null; ref?: string;
  /** provenance for review UI */ page?: number; line?: number; confidence: number; warnings?: string[];
}
export interface ParsedStatement {
  rows: ParsedRow[]; format: 'csv' | 'ofx' | 'qif' | 'pdf';
  openingBalance?: number | null; closingBalance?: number | null; periodStart?: string | null; periodEnd?: string | null;
  skipped: { line: number; text: string; reason: string }[]; warnings: string[];
}
export class ImportError extends Error {}
export const LIMITS = { maxBytes: 25 * 1024 * 1024, maxRows: 200_000, maxPdfPages: 300, timeMs: 30_000 };
export function guardSize(len: number) { if (len > LIMITS.maxBytes) throw new ImportError(`File is ${(len / 1048576).toFixed(1)} MB — the limit is ${LIMITS.maxBytes / 1048576} MB`); }
