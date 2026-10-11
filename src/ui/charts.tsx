import { useState } from 'react';
import { compactMoney, formatMoney } from '../core/money';

const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const short = (k: string) => MN[Number(k.slice(5)) - 1].slice(0, 3);
const long = (k: string) => `${MN[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;

/** Round the top of the scale up to 1, 2 or 5 × 10ⁿ so the gridline labels read cleanly. */
function niceMax(v: number): number {
  if (v <= 0) return 100000;
  const p = 10 ** Math.floor(Math.log10(v)); const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export interface MonthPoint { month: string; income: number; expense: number }

/** Spending as bars, income as a thin tick across each bar. Select a month to read its figures. */
export function MonthsChart({ series }: { series: MonthPoint[] }) {
  const [sel, setSel] = useState(series.length - 1);
  const top = niceMax(Math.max(...series.map((s) => Math.max(s.income, s.expense)), 1));
  const ticks = [1, 0.5, 0];
  const cur = series[Math.min(sel, series.length - 1)];
  const kept = cur.income - cur.expense;
  return <div className="chart">
    <div className="plot">
      <div className="axis" aria-hidden="true">{ticks.map((t) => <span key={t} style={{ bottom: `${t * 100}%` }}>{t === 0 ? '0' : compactMoney(top * t)}</span>)}</div>
      <div className="grid" aria-hidden="true">{ticks.map((t) => <i key={t} style={{ bottom: `${t * 100}%` }} />)}</div>
      <div className="cols" role="group" aria-label="Spending by month. Bars show money out, the tick shows money in.">
        {series.map((s, i) => {
          const h = (s.expense / top) * 100; const ih = (s.income / top) * 100; const on = i === sel;
          return <button key={s.month} className={`col ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setSel(i)} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)}
            aria-label={`${long(s.month)}: spent ${formatMoney(s.expense)}, came in ${formatMoney(s.income)}`}>
            <span className="barbox">
              {on && s.expense > 0 && <span className="val" style={{ bottom: `calc(${Math.max(h, ih)}% + 8px)` }}>{compactMoney(s.expense)}</span>}
              <span className="bar" style={{ height: `${h}%` }} />
              {s.income > 0 && <span className="tick" style={{ bottom: `${ih}%` }} />}
            </span>
            <span className="mon">{short(s.month)}{s.month.endsWith('-01') ? <span className="yr"> {s.month.slice(2, 4)}</span> : null}</span>
          </button>;
        })}
      </div>
    </div>
    <p className="readout" aria-live="polite"><strong>{long(cur.month)}</strong> You spent {formatMoney(cur.expense)} and {cur.income ? `${formatMoney(cur.income)} came in` : 'nothing came in'}{cur.income || cur.expense ? <>, so you {kept >= 0 ? 'kept' : 'were short by'} {formatMoney(Math.abs(kept))}.</> : '.'}</p>
    <p className="key"><span><span className="k-bar" /> Money out</span><span><span className="k-tick" /> Money in</span><span className="note">Transfers between your own accounts are left out.</span></p>
  </div>;
}

/** The 60-day outlook: a single line with the two figures that matter labelled directly. */
export function Outlook({ pts, startDate, endDate }: { pts: number[]; startDate: string; endDate: string }) {
  const w = 600, h = 96, pad = 6; const mn = Math.min(...pts, 0), mx = Math.max(...pts, 1); const sx = w / (pts.length - 1);
  const y = (v: number) => h - pad - ((v - mn) / (mx - mn || 1)) * (h - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * sx).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${y(Math.max(mn, 0))} L0,${y(Math.max(mn, 0))} Z`;
  const below = pts.some((p) => p < 0);
  return <div className="outlook">
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label={`Projected balance from ${compactMoney(pts[0])} to ${compactMoney(pts[pts.length - 1])}`}>
      {mn < 0 && <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
      <path d={area} fill="var(--wash)" /><path d={line} fill="none" stroke={below ? 'var(--out)' : 'var(--slate)'} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="ends"><span><span className="muted small">{startDate}</span><br /><strong>{compactMoney(pts[0])}</strong></span><span style={{ textAlign: 'right' }}><span className="muted small">{endDate}</span><br /><strong>{compactMoney(pts[pts.length - 1])}</strong></span></div>
  </div>;
}
