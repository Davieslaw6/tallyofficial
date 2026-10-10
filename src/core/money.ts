/** All money is integer kobo (1/100 NGN) to avoid float drift. */
export const toMinor = (n: number | string): number => {
  const s = typeof n === 'number' ? n.toFixed(2) : n.replace(/[^0-9.\-]/g, '');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
};
export const fromMinor = (m: number): number => m / 100;

export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/(?:DR|D)$/i.test(s)) { neg = true; s = s.replace(/\s*(DR|D)$/i, ''); }
  s = s.replace(/\s*(CR|C)$/i, '');
  if (s.startsWith('-') || s.endsWith('-')) { neg = true; s = s.replace(/^-|-$/g, ''); }
  s = s.replace(/[₦$€£\sA-Za-z]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * 100);
  return neg ? -v : v;
}

const fmt = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatMoney(minor: number, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  const abs = fmt.format(Math.abs(minor) / 100);
  const sign = minor < 0 ? '\u2212' : opts.sign && minor > 0 ? '+' : '';
  return `${sign}${opts.symbol === false ? '' : '\u20A6'}${abs}`;
}
export function compactMoney(minor: number): string {
  const a = Math.abs(minor) / 100;
  const s = a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'k' : a.toFixed(0);
  return (minor < 0 ? '\u2212' : '') + '\u20A6' + s;
}

/** Split an amount into n parts that sum exactly. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.trunc((total * w) / sum));
  let rem = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rem !== 0; i = (i + 1) % out.length) { out[i] += Math.sign(rem); rem -= Math.sign(rem); }
  return out;
}
