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
  return <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}><h2 style={{ fontSize: 18 }}>{title}</h2><button className="btn quiet small" onClick={onClose} aria-label="Close">Close</button></div>{children}</div></div>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useTrap(onClose);
  return <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}><h2 style={{ marginBottom: 12, fontSize: 18 }}>{title}</h2>{children}</div></div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><label style={{ display: 'grid', gap: 6 }}><span>{label}</span>{children}</label>{hint && <small>{hint}</small>}</div>;
}
export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="empty"><h3>{title}</h3><p>{body}</p>{action}</div>; }
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) { return <section className="section"><header><h2>{title}</h2>{actions && <div className="actions">{actions}</div>}</header>{children}</section>; }

/** One thin ribbon in tints of a single hue; position and share carry the information, not colour. */
export function Ribbon({ parts, play, onPick }: { parts: { id: number | null; name: string; value: number }[]; play?: boolean; onPick?: (id: number | null) => void }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1; const tone = (i: number) => `t${Math.min(i, 7)}`;
  return <>
    <div className={`ribbon ${play ? 'play' : ''}`} role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
      {parts.map((p, i) => <i key={p.name + i} className={tone(i)} style={{ flex: Math.max(p.value / total, 0.01) }} title={p.name} />)}
    </div>
    <div className="legend">{parts.slice(0, 8).map((p, i) => <button key={p.name + i} onClick={() => onPick?.(p.id)}><i className={tone(i)} />{p.name} {Math.round((p.value / total) * 100)}%</button>)}</div>
  </>;
}
export const Logo = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5v14M10 5v14M15 5v14M20 5v14" /><path d="M2.5 16 21.5 8" /></svg>;
