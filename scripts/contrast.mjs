const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const themes = {
  light: { text: '#2A2F33', quiet: '#626A71', out: '#86566A', in: '#4E6F5C', flag: '#7A6232', slate: '#4F6272', bg: '#F5F6F6', panel: '#FFFFFF', flagBg: '#F1EEE4', btnText: '#FFFFFF', btnBg: '#4F6272' },
  dark: { text: '#E4E6E8', quiet: '#9AA1A7', out: '#C493A6', in: '#8FB09B', flag: '#CDB27A', slate: '#9FB1BF', bg: '#16181A', panel: '#1D2023', flagBg: '#2C2820', btnText: '#14181B', btnBg: '#9FB1BF' },
  contrast: { text: '#000000', quiet: '#2B2B2B', out: '#6B0F2E', in: '#0B4D26', flag: '#4D3200', slate: '#1F3A52', bg: '#FFFFFF', panel: '#FFFFFF', flagBg: '#FFF4D6', btnText: '#FFFFFF', btnBg: '#1F3A52' } };
let bad = 0; for (const [n, t] of Object.entries(themes)) for (const [k, fg, bg] of [['text/bg', t.text, t.bg], ['text/panel', t.text, t.panel], ['quiet/panel', t.quiet, t.panel], ['quiet/bg', t.quiet, t.bg], ['money out/bg', t.out, t.bg], ['money in/bg', t.in, t.bg], ['flag tag', t.flag, t.flagBg], ['link/bg', t.slate, t.bg], ['button', t.btnText, t.btnBg]]) { const r = ratio(fg, bg); const ok = r >= 4.5; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n.padEnd(8)} ${k.padEnd(16)} ${r.toFixed(2)}:1`); }
process.exit(bad ? 1 : 0);
