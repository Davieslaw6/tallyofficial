import { useEffect, useState } from 'react';
import './styles.css';
import { Welcome, type Landing } from './Welcome';
import { AppProvider, useApp, type View } from './store';
import { applyPrefs, loadPrefs, bootEngine, vaults, type Prefs } from './boot';
import { Today } from './Today';
import { MoneyView, TxDrawer, TransferModal } from './Money';
import { ImportView } from './ImportView';
import { CheckView } from './Check';
import { PlanView } from './Plan';
import { SafeView } from './Safe';
import { Logo } from './ui';
import { ask, type Answer } from '../core/nlq';
import { Repo } from '../core/repo';
import type { Session } from '../core/vault';

const NAV: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'money', label: 'Money' }, { id: 'import', label: 'Import' }, { id: 'check', label: 'Check' }, { id: 'plan', label: 'Plan' }, { id: 'safe', label: 'Settings' },
];

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs()); const [session, setSession] = useState<Session | null>(null); const [setup, setSetup] = useState(false);
  const [view, setView] = useState<View>('today'); const [play, setPlay] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { applyPrefs(prefs); const mq = matchMedia('(prefers-color-scheme: dark)'); const f = () => applyPrefs(prefs); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [prefs]);
  useEffect(() => {
    let live = true;
    bootEngine().then(() => vaults.openPlain()).then((s) => { if (!live) return; setSetup(new Repo(s.db).accounts().length === 0); setSession(s); }).catch((e) => setErr(e?.message ?? 'This browser blocked local storage, so Tally cannot save anything. Turn off private browsing and reload.'));
    return () => { live = false; };
  }, []);
  useEffect(() => { if (!session) return; const f = () => { if (document.visibilityState === 'hidden') void session.flush().catch(() => {}); }; document.addEventListener('visibilitychange', f); addEventListener('pagehide', f); return () => { document.removeEventListener('visibilitychange', f); removeEventListener('pagehide', f); }; }, [session]);

  if (err) return <main className="welcome"><h1>Tally can’t open</h1><p className="err" role="alert">{err}</p><button className="btn" onClick={() => location.reload()}>Reload</button></main>;
  if (!session) return <main className="welcome"><div className="skeleton" style={{ width: 120 }} aria-label="Loading" /></main>;
  if (setup) return <Welcome session={session} onDone={(l: Landing) => { setView(l); setSetup(false); setPlay(true); setTimeout(() => setPlay(false), 1200); }} />;
  return <Shell session={session} view={view} setView={setView} prefs={prefs} setPrefs={setPrefs} play={play} />;
}

function Shell(p: { session: Session; view: View; setView: (v: View) => void; prefs: Prefs; setPrefs: (p: Prefs) => void; play: boolean }) {
  const [add, setAdd] = useState(false); const [xfer, setXfer] = useState(false); const [pal, setPal] = useState(false);
  // Quick-actions palette: opened with the usual Ctrl/Cmd+K, deliberately not advertised anywhere in the interface.
  useEffect(() => { const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((x) => !x); } }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return <AppProvider session={p.session} view={p.view} go={p.setView} openAdd={() => setAdd(true)} openTransfer={() => setXfer(true)}>
    <Inner {...p} />{add && <TxDrawer id={null} onClose={() => setAdd(false)} />}{xfer && <TransferModal onClose={() => setXfer(false)} />}{pal && <Palette onClose={() => setPal(false)} openAdd={() => setAdd(true)} openTransfer={() => setXfer(true)} />}<Toasts />
  </AppProvider>;
}

function Inner({ view, setView, play, prefs, setPrefs }: { view: View; setView: (v: View) => void; play: boolean; prefs: Prefs; setPrefs: (p: Prefs) => void; session: Session }) {
  const { repo, today, v, openAdd } = useApp(); const [q, setQ] = useState(''); const [ans, setAns] = useState<Answer | null>(null);
  const review = repo.db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE category_id IS NULL AND transfer_group IS NULL') ?? 0; void v;
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) setAns(ask(repo, q, today)); };
  return <div className="page">
    <header className="head"><div className="brand"><Logo /> Tally</div>
      <nav className="nav" aria-label="Main">{NAV.map((n) => <button key={n.id} aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>{n.label}{n.id === 'money' && review > 0 && <span className="count" title={`${review} without a category`}>{review}</span>}</button>)}</nav>
      <button className="btn small" onClick={openAdd}>Add</button></header>
    <form className="ask" onSubmit={submit} role="search"><input aria-label="Ask about your money" placeholder="Ask a question, like “groceries last month”" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setAns(null); }} /></form>
    {ans && <div className="answer" role="status"><p style={{ margin: 0 }}>{ans.text}</p>{ans.rows && <div className="small muted" style={{ marginTop: 6 }}>{ans.rows.map((r) => `${r.label}: ₦${(r.value / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`).join('   ')}</div>}<button className="link small" style={{ marginTop: 6 }} onClick={() => { setAns(null); setQ(''); }}>Dismiss</button></div>}
    <main id="main">{view === 'today' && <Today play={play} />}{view === 'money' && <MoneyView />}{view === 'import' && <ImportView />}{view === 'check' && <CheckView />}{view === 'plan' && <PlanView />}{view === 'safe' && <SafeView prefs={prefs} setPrefs={setPrefs} />}</main>
  </div>;
}

function Palette({ onClose, openAdd, openTransfer }: { onClose: () => void; openAdd: () => void; openTransfer: () => void }) {
  const { go } = useApp(); const [q, setQ] = useState(''); const [i, setI] = useState(0);
  const cmds: { label: string; run: () => void }[] = [{ label: 'Add a transaction', run: openAdd }, { label: 'Move money between accounts', run: openTransfer }, ...NAV.map((n) => ({ label: `Go to ${n.label}`, run: () => go(n.id) }))];
  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())); const run = (c?: { run: () => void }) => { if (!c) return; onClose(); c.run(); };
  return <div className="scrim" style={{ justifyContent: 'center' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="palette" role="dialog" aria-modal="true" aria-label="Quick actions">
    <input autoFocus placeholder="Type a command" aria-label="Command" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); } else if (e.key === 'Enter') run(list[i]); }} />
    <ul role="listbox" aria-label="Commands">{list.map((c, k) => <li key={c.label} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => run(c)}>{c.label}</li>)}{!list.length && <li className="muted">No matching command</li>}</ul></div></div>;
}
function Toasts() { const { toasts } = useApp(); return <div className="toasts" aria-live="polite" role="status">{toasts.map((t) => <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`}>{t.text}</div>)}</div>; }
