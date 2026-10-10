import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '../core/vault';
import { Repo } from '../core/repo';
import { makeCategorizer } from '../core/ingest';
import type { Categorizer } from '../core/categorize';
import { todayIso, monthKey } from '../core/dates';

export interface Toast { id: number; text: string; bad?: boolean }
export interface Ctx {
  session: Session; repo: Repo; cat: Categorizer; v: number; today: string; month: string; setMonth: (m: string) => void;
  /** call after any mutation: bumps the version (re-render) and schedules an encrypted save */
  changed: () => void; toast: (t: string, bad?: boolean) => void; toasts: Toast[]; refreshCat: () => void;
  go: (v: View) => void; view: View; lock: () => void; openAdd: () => void; openTransfer: () => void; setFilterCat: (id: number | null) => void; filterCat: number | null;
}
export type View = 'today' | 'money' | 'import' | 'check' | 'plan' | 'safe';
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error('outside provider'); return c; };

export function AppProvider(p: { session: Session; onLock: () => void; view: View; go: (v: View) => void; openAdd: () => void; openTransfer: () => void; children: ReactNode }) {
  const [v, setV] = useState(0); const [toasts, setToasts] = useState<Toast[]>([]); const nid = useRef(1);
  const today = todayIso(); const [month, setMonth] = useState(monthKey(today)); const [filterCat, setFilterCat] = useState<number | null>(null);
  const repo = useMemo(() => new Repo(p.session.db), [p.session]);
  const [cat, setCat] = useState(() => makeCategorizer(repo));
  const changed = useCallback(() => { p.session.touch(); setV((x) => x + 1); }, [p.session]);
  const toast = useCallback((text: string, bad = false) => { const id = nid.current++; setToasts((t) => [...t, { id, text, bad }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 6000 : 3200); }, []);
  p.session.onSaveError = () => toast('Could not save your changes. Storage may be full — they are kept in memory and will be retried.', true);
  const value: Ctx = { session: p.session, repo, cat, v, today, month, setMonth, changed, toast, toasts, refreshCat: () => setCat(makeCategorizer(repo)), go: p.go, view: p.view, lock: p.onLock, openAdd: p.openAdd, openTransfer: p.openTransfer, setFilterCat, filterCat };
  return <C.Provider value={value}>{p.children}</C.Provider>;
}
