/** Dates are plain ISO local dates (YYYY-MM-DD) — never Date objects with timezones — so DST cannot shift a transaction. */
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export function validIso(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return mo >= 1 && mo <= 12 && d >= 1 && d <= dim;
}
export function todayIso(now = new Date()): string { return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate()); }
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return isoDate(ny, nm, Math.min(d, dim));
}
export function diffDays(a: string, b: string): number {
  const f = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((f(a) - f(b)) / 86400000);
}
export const monthKey = (iso: string) => iso.slice(0, 7);
export function monthRange(key: string): [string, string] {
  const [y, m] = key.split('-').map(Number);
  return [isoDate(y, m, 1), isoDate(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate())];
}
export const shiftMonth = (key: string, n: number) => monthKey(addMonths(key + '-01', n));
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
/** Parse many human date formats; ambiguous dd/mm vs mm/dd defaults to day-first (Nigeria/UK). */
export function parseDate(raw: string, dayFirst = true): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) { const r = isoDate(+m[1], +m[2], +m[3]); return validIso(r) ? r : null; }
  if ((m = /^(\d{8})$/.exec(s)) || (m = /^(\d{8})\d{0,6}/.exec(s))) { const t = m[1]; const r = isoDate(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8)); return validIso(r) ? r : null; }
  if ((m = /^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]*(\d{2,4})/.exec(s))) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1; if (!mo) return null;
    let y = +m[3]; if (y < 100) y += 2000; const r = isoDate(y, mo, +m[1]); return validIso(r) ? r : null;
  }
  if ((m = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})/.exec(s))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1; if (!mo) return null;
    const r = isoDate(+m[3], mo, +m[2]); return validIso(r) ? r : null;
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let d = dayFirst ? a : b, mo = dayFirst ? b : a;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const r = isoDate(y, mo, d); return validIso(r) ? r : null;
  }
  return null;
}
