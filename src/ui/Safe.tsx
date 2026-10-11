import { useRef, useState } from 'react';
import { useApp } from './store';
import { Section, Modal, Field } from './ui';
import { applyPrefs, download, vaults, type Prefs } from './boot';
import { readLog, verifyChain, logEvent } from '../core/audit';
import { toMinor } from '../core/money';

export function SafeView({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const { session, repo, changed, toast, v } = useApp(); const [wipe, setWipe] = useState(false); const [err, setErr] = useState(''); const file = useRef<HTMLInputElement>(null);
  const [an, setAn] = useState(''); const [ak, setAk] = useState('checking'); const [ao, setAo] = useState(''); const [cn, setCn] = useState(''); const [ck, setCk] = useState<'expense' | 'income'>('expense');
  const set = (p: Partial<Prefs>) => { const n = { ...prefs, ...p }; setPrefs(n); applyPrefs(n); };
  const log = readLog(repo.db, 50); const chain = verifyChain(repo.db); void v;
  const backup = async () => { const b = await session.exportArchive(); download(`tally-backup-${new Date().toISOString().slice(0, 10)}.tally`, b); logEvent(repo.db, 'backup', 'manual'); changed(); toast('Backup saved'); };
  async function restore(f: File) { if (!confirm('Replace everything in Tally with this backup?')) return; try { await vaults.restorePlain(session.id, new Uint8Array(await f.arrayBuffer())); location.reload(); } catch { setErr('That file is not a Tally backup.'); } }
  return <div>
    <Section title="Appearance"><div className="grid2"><Field label="Theme"><select value={prefs.theme} onChange={(e) => set({ theme: e.target.value as Prefs['theme'] })}><option value="auto">Match my device</option><option value="light">Light</option><option value="dark">Dark</option><option value="contrast">High contrast</option></select></Field>
      <Field label="Row spacing"><select value={prefs.density} onChange={(e) => set({ density: e.target.value as Prefs['density'] })}><option value="compact">Compact</option><option value="cozy">Comfortable</option><option value="roomy">Roomy</option></select></Field></div></Section>

    <Section title="Accounts and categories">
      <div className="list">{repo.accounts().map((a) => <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}><span>{a.name} <span className="muted small">{a.kind}</span></span><span className="small muted">opened at ₦{(a.opening_balance / 100).toLocaleString('en-NG')}</span></div>)}</div>
      <div className="row" style={{ alignItems: 'end', marginTop: 16 }}><Field label="New account"><input value={an} onChange={(e) => setAn(e.target.value)} placeholder="Savings" /></Field><Field label="Type"><select value={ak} onChange={(e) => setAk(e.target.value)}><option value="checking">Current</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="cash">Cash</option><option value="investment">Investment</option></select></Field><Field label="Opening balance (₦)"><input inputMode="decimal" value={ao} onChange={(e) => setAo(e.target.value)} /></Field>
        <button className="btn" style={{ marginBottom: 16 }} onClick={() => { try { repo.addAccount(an, ak, toMinor(ao || '0')); setAn(''); setAo(''); changed(); toast('Account added'); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } }}>Add account</button></div>
      <div className="row" style={{ alignItems: 'end' }}><Field label="New category"><input value={cn} onChange={(e) => setCn(e.target.value)} /></Field><Field label="Kind"><select value={ck} onChange={(e) => setCk(e.target.value as 'expense')}><option value="expense">Spending</option><option value="income">Income</option></select></Field>
        <button className="btn" style={{ marginBottom: 16 }} onClick={() => { try { repo.addCategory(cn, ck); setCn(''); changed(); toast('Category added'); } catch { setErr('A category with that name already exists.'); } }}>Add category</button></div><p className="err" role="alert">{err}</p></Section>

    <Section title="Backup"><p className="muted">Your data lives in this browser on this device. Save a backup file to keep a copy elsewhere or move to another device. The file is not password-protected, so store it somewhere private.</p>
      <div className="row"><button className="btn" onClick={backup}>Save backup</button><button className="btn quiet" onClick={() => file.current?.click()}>Restore from backup</button><input ref={file} type="file" accept=".tally" className="sr" aria-label="Backup file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} /></div></Section>

    <Section title="Network"><p className="muted">Tally makes no network connections. There is no server, no account and no analytics. After the first load, the Network tab in your browser’s developer tools stays empty.</p></Section>

    <Section title="Activity" actions={<span className={`tag ${chain.ok ? 'good' : 'bad'}`}>{chain.ok ? 'Log intact' : `Edited at entry ${chain.brokenAt}`}</span>}>
      <p className="muted small">Imports, exports and checks are recorded. Each entry is linked to the one before it, so edits or deletions show up here.</p>
      <div className="list small">{log.map((r) => <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}><span>{r.event.replace('.', ' ')} <span className="muted">{r.detail}</span></span><span className="muted">{r.ts.slice(0, 16).replace('T', ' ')}</span></div>)}</div></Section>

    <Section title="Erase"><p className="muted">Remove all Tally data from this browser. Save a backup first if you may want it again.</p><button className="btn danger" onClick={() => setWipe(true)}>Erase all data</button></Section>
    {wipe && <Modal title="Erase all data?" onClose={() => setWipe(false)}><WipeBody onClose={() => setWipe(false)} /></Modal>}
  </div>;
  function WipeBody({ onClose }: { onClose: () => void }) { const [t, setT] = useState(''); return <><p>Every transaction, receipt and setting will be deleted from this device. This cannot be undone.</p><Field label="Type DELETE to confirm"><input value={t} onChange={(e) => setT(e.target.value)} autoFocus /></Field><div className="row"><button className="btn danger" disabled={t !== 'DELETE'} onClick={async () => { const id = session.id; session.db.close(); await vaults.wipe(id); location.reload(); }}>Erase everything</button><button className="btn quiet" onClick={onClose}>Cancel</button></div></>; }
}
