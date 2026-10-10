import { useCallback, useEffect, useRef, useState } from 'react';
import './styles.css';
import { Gate, type Landing } from './Gate';
import { AppProvider, useApp, type View } from './store';
import { applyPrefs, loadPrefs, type Prefs } from './boot';
import { Today } from './Today';
import { MoneyView, TxDrawer, TransferModal } from './Money';
import { ImportView } from './ImportView';
import { CheckView } from './Check';
import { PlanView } from './Plan';
import { SafeView } from './Safe';
import { Logo } from './ui';
import { ask, type Answer } from '../core/nlq';
import type { Session } from '../core/vault';

const NAV: { id: View; label: string; hint: string }[] = [
  { id: 'today', label: 'Today', hint: 'Where you stand' }, { id: 'money', label: 'Money', hint: 'Every transaction' }, { id: 'import', label: 'Import', hint: 'Bring in a statement' },
  { id: 'check', label: 'Check', hint: 'Match the bank' }, { id: 'plan', label: 'Plan', hint: 'Budgets and goals' }, { id: 'safe', label: 'Safe', hint: 'Settings and backup' },
];

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs()); const [session, setSession] = useState<Session | null>(null); const [view, setView] = useState<View>('today'); const [play, setPlay] = useState(false); const [cover, setCover] = useState(false);
  useEffect(() => { applyPrefs(prefs); const mq = matchMedia('(prefers-color-scheme: dark)'); const f = () => applyPrefs(prefs); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [prefs]);
  const open = (s: Session, l: Landing) => { setSession(s); setView(l); setPlay(true); setTimeout(() => setPlay(false), 1500); };
  const lock = useCallback(async () => { if (!session) return; setCover(true); try { await session.lock(); setSession(null); } catch { alert('Tally could not save your latest changes (is the device storage full?), so it stayed unlocked. Free some space and try locking again.'); } finally { setCover(false); } }, [session]);

  // auto-lock on inactivity + panic hotkey
  const last = useRef(Date.now());
  useEffect(() => {
    if (!session) return; const bump = () => { last.current = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart']; evs.forEach((e) => addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => { if (prefs.lockMinutes && Date.now() - last.current > prefs.lockMinutes * 60000) void lock(); }, 5000);
    const panic = (e: KeyboardEvent) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); void lock(); } };
    addEventListener('keydown', panic); return () => { evs.forEach((e) => removeEventListener(e, bump)); clearInterval(iv); removeEventListener('keydown', panic); };
  }, [session, prefs.lockMinutes, lock]);
  useEffect(() => { if (!session) return; const f = () => { if (document.visibilityState === 'hidden') void session.flush(); }; document.addEventListener('visibilitychange', f); addEventListener('pagehide', f); return () => { document.removeEventListener('visibilitychange', f); removeEventListener('pagehide', f); }; }, [session]);

  if (cover) return <div className="lockcover" role="status">Locking…</div>;
  if (!session) return <Gate onOpen={open} />;
  return <Shell session={session} view={view} setView={setView} lock={lock} prefs={prefs} setPrefs={setPrefs} play={play} />;
}

function Shell(p: { session: Session; view: View; setView: (v: View) => void; lock: () => void; prefs: Prefs; setPrefs: (p: Prefs) => void; play: boolean }) {
  const [add, setAdd] = useState(false); const [xfer, setXfer] = useState(false); const [pal, setPal] = useState(false);
  useEffect(() => { const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((x) => !x); } }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return <AppProvider session={p.session} onLock={p.lock} view={p.view} go={p.setView} openAdd={() => setAdd(true)} openTransfer={() => setXfer(true)}>
    <Inner {...p} />{add && <TxDrawer id={null} onClose={() => setAdd(false)} />}{xfer && <TransferModal onClose={() => setXfer(false)} />}{pal && <Palette onClose={() => setPal(false)} openAdd={() => setAdd(true)} openTransfer={() => setXfer(true)} setPrefs={p.setPrefs} prefs={p.prefs} />}<Toasts />
  </AppProvider>;
}

function Inner({ view, setView, play, prefs, setPrefs }: { view: View; setView: (v: View) => void; play: boolean; prefs: Prefs; setPrefs: (p: Prefs) => void; lock: () => void; session: Session }) {
  const { repo, today, lock, v, openAdd } = useApp(); const [q, setQ] = useState(''); const [ans, setAns] = useState<Answer | null>(null);
  const review = repo.db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE category_id IS NULL AND transfer_group IS NULL') ?? 0; void v;
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) setAns(ask(repo, q, today)); };
  const nav = (n: (typeof NAV)[number]) => <button key={n.id} className="nav" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>{n.label}{n.id === 'money' && review > 0 && <span className="badge" title={`${review} uncategorized`}>{review}</span>}</button>;
  return <div className="app">
    <nav className="rail" aria-label="Main"><div className="brand"><Logo /> Tally</div>{NAV.map(nav)}<div className="spacer" /><button className="nav" onClick={lock}>Lock</button></nav>
    <main className="main" id="main">
      <div className="top"><form className="ask" onSubmit={submit} role="search"><input aria-label="Ask about your money" placeholder="Ask: how much did I spend on groceries last month?" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setAns(null); }} /><kbd aria-hidden>Ctrl K</kbd></form>
        <button className="btn small" onClick={openAdd}>Add</button><button className="btn quiet small" onClick={lock} aria-label="Lock now">Lock</button></div>
      {ans && <div className="answer" role="status"><p style={{ margin: 0 }}><strong>{ans.text}</strong></p>{ans.rows && <div className="small muted" style={{ marginTop: 6 }}>{ans.rows.map((r) => `${r.label}: ₦${(r.value / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`).join('  |  ')}</div>}<button className="btn quiet small" style={{ marginTop: 8 }} onClick={() => { setAns(null); setQ(''); }}>Dismiss</button></div>}
      {view === 'today' && <Today play={play} />}{view === 'money' && <MoneyView />}{view === 'import' && <ImportView />}{view === 'check' && <CheckView />}{view === 'plan' && <PlanView />}{view === 'safe' && <SafeView prefs={prefs} setPrefs={setPrefs} />}
    </main>
    <nav className="tabs" aria-label="Main">{NAV.map(nav)}</nav>
  </div>;
}

function Palette({ onClose, openAdd, openTransfer, prefs, setPrefs }: { onClose: () => void; openAdd: () => void; openTransfer: () => void; prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const { go, lock } = useApp(); const [q, setQ] = useState(''); const [i, setI] = useState(0); const ref = useRef<HTMLInputElement>(null); useEffect(() => ref.current?.focus(), []);
  const cmds: { label: string; run: () => void }[] = [
    { label: 'Add a transaction', run: openAdd }, { label: 'Move money between accounts', run: openTransfer },
    ...NAV.map((n) => ({ label: `Go to ${n.label}: ${n.hint}`, run: () => go(n.id) })),
    { label: 'Import a statement', run: () => go('import') }, { label: 'Lock now', run: lock },
    { label: 'Switch to dark theme', run: () => { const n = { ...prefs, theme: 'dark' as const }; setPrefs(n); applyPrefs(n); } }, { label: 'Switch to light theme', run: () => { const n = { ...prefs, theme: 'light' as const }; setPrefs(n); applyPrefs(n); } },
  ];
  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  const run = (c?: { run: () => void }) => { if (!c) return; onClose(); c.run(); };
  return <div className="scrim" style={{ justifyContent: 'center' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="palette" role="dialog" aria-modal="true" aria-label="Quick actions">
    <input ref={ref} placeholder="Type a command" aria-label="Command" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); } else if (e.key === 'Enter') run(list[i]); }} />
    <ul role="listbox" aria-label="Commands">{list.map((c, k) => <li key={c.label} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => run(c)}>{c.label}</li>)}{!list.length && <li className="muted">No matching command</li>}</ul></div></div>;
}

function Toasts() { const { toasts } = useApp(); return <div className="toasts" aria-live="polite" role="status">{toasts.map((t) => <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`}>{t.text}</div>)}</div>; }
