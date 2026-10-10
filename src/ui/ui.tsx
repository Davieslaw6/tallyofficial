import { useEffect, useRef, type ReactNode } from 'react';
import { formatMoney } from '../core/money';

export function Money({ v, sign, plain }: { v: number; sign?: boolean; plain?: boolean }) {
  return <span className={`amt ${plain ? '' : v < 0 ? 'out' : v > 0 ? 'in' : ''}`}>{formatMoney(v, { sign })}</span>;
}

function useTrap(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; const el = ref.current!; const f = () => el.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    (el.querySelector<HTMLElement>('[autofocus],input,select,button') ?? el).focus();
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') { const a = [...f()].filter((x) => !x.hasAttribute('disabled')); if (!a.length) return; const first = a[0], last = a[a.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    el.addEventListener('keydown', kd); return () => { el.removeEventListener('keydown', kd); prev?.focus?.(); };
  }, []); // eslint-disable-line
  return ref;
}
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useTrap(onClose);
  return <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}><h2>{title}</h2><button className="btn quiet small" onClick={onClose} aria-label="Close">Close</button></div>{children}</div></div>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useTrap(onClose);
  return <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}><h2 style={{ marginBottom: 12 }}>{title}</h2>{children}</div></div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><label style={{ display: 'grid', gap: 4 }}><span>{label}</span>{children}</label>{hint && <small>{hint}</small>}</div>;
}
export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="empty"><h3>{title}</h3><p className="muted">{body}</p>{action}</div>; }
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) { return <section className="section"><header><h2>{title}</h2>{actions && <div className="actions">{actions}</div>}</header>{children}</section>; }

const DYES = ['#1B2160', '#3342B8', '#6573E0', '#A3194B', '#19734F', '#B7791F', '#2A7F9E', '#7A3FA0', '#8A90A6', '#C0408A', '#2D6A4F', '#B3541E'];
export const dyeColor = (i: number, own?: string | null) => own ?? DYES[i % DYES.length];
/** One strip, many segments, small gaps between: the app's signature element. */
export function DyeBar({ parts, play, onPick }: { parts: { id: number | null; name: string; value: number; color?: string | null }[]; play?: boolean; onPick?: (id: number | null) => void }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return <>
    <div className={`dye ${play ? 'play' : ''}`} role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
      {parts.map((p, i) => <i key={p.name + i} style={{ flex: Math.max(p.value / total, 0.012), background: dyeColor(i, p.color), animationDelay: `${i * 70}ms` }} title={p.name} />)}
    </div>
    <div className="legend">{parts.slice(0, 8).map((p, i) => <button key={p.name + i} onClick={() => onPick?.(p.id)}><i style={{ background: dyeColor(i, p.color) }} />{p.name} <span className="muted">{Math.round((p.value / total) * 100)}%</span></button>)}</div>
  </>;
}
export const Logo = () => <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="currentColor" /><g fill="var(--cotton)"><rect x="12" y="14" width="6" height="36" rx="2" /><rect x="23" y="14" width="6" height="36" rx="2" /><rect x="34" y="14" width="6" height="36" rx="2" /><rect x="45" y="14" width="6" height="36" rx="2" /></g><path d="M8 44 L56 20" stroke="#B7791F" strokeWidth="5" strokeLinecap="round" /></svg>;
