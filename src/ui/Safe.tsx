import { useState } from 'react';
import { useApp } from './store';
import { Section, Modal, Field } from './ui';
import { applyPrefs, loadPrefs, download, vaults, type Prefs } from './boot';
import { readLog, verifyChain, logEvent } from '../core/audit';
import { checkPassphrase } from '../core/crypto';
import { toMinor } from '../core/money';

export function SafeView({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const { session, repo, changed, toast, v, lock } = useApp(); const [pw, setPw] = useState(false); const [wipe, setWipe] = useState(false); const [err, setErr] = useState('');
  const [an, setAn] = useState(''); const [ak, setAk] = useState('checking'); const [ao, setAo] = useState(''); const [cn, setCn] = useState(''); const [ck, setCk] = useState<'expense' | 'income'>('expense');
  const set = (p: Partial<Prefs>) => { const n = { ...prefs, ...p }; setPrefs(n); applyPrefs(n); };
  const log = readLog(repo.db, 100); const chain = verifyChain(repo.db); void v;
  const backup = async () => { const b = await session.exportArchive(); download(`${session.name.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.tally`, b); logEvent(repo.db, 'backup', 'manual'); changed(); toast('Encrypted backup saved. Keep it somewhere safe.'); };
  return <div className="sheet">
    <Section title="Appearance"><div className="grid2"><Field label="Theme"><select value={prefs.theme} onChange={(e) => set({ theme: e.target.value as Prefs['theme'] })}><option value="auto">Match my device</option><option value="light">Light</option><option value="dark">Dark</option><option value="contrast">High contrast</option></select></Field>
      <Field label="Row spacing"><select value={prefs.density} onChange={(e) => set({ density: e.target.value as Prefs['density'] })}><option value="compact">Compact</option><option value="cozy">Comfortable</option><option value="roomy">Roomy</option></select></Field></div></Section>

    <Section title="Locking"><Field label="Lock after being idle for" hint="Locking wipes the key from memory. Press Ctrl+Shift+L any time to hide the screen and lock now."><select value={prefs.lockMinutes} onChange={(e) => set({ lockMinutes: +e.target.value })}>{[1, 2, 5, 10, 30, 0].map((m) => <option key={m} value={m}>{m ? `${m} minute${m > 1 ? 's' : ''}` : 'Never'}</option>)}</select></Field>
      <div className="row"><button className="btn" onClick={lock}>Lock now</button><button className="btn quiet" onClick={() => setPw(true)}>Change passphrase</button></div></Section>

    <Section title="Accounts and categories">
      <div className="list">{repo.accounts().map((a) => <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}><span>{a.name} <span className="muted small">{a.kind}</span></span><span className="small muted">opened at ₦{(a.opening_balance / 100).toLocaleString('en-NG')}</span></div>)}</div>
      <div className="row" style={{ alignItems: 'end', marginTop: 12 }}><Field label="New account"><input value={an} onChange={(e) => setAn(e.target.value)} placeholder="Savings" /></Field><Field label="Type"><select value={ak} onChange={(e) => setAk(e.target.value)}><option value="checking">Current</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="cash">Cash</option><option value="investment">Investment</option></select></Field><Field label="Opening balance (₦)"><input inputMode="decimal" value={ao} onChange={(e) => setAo(e.target.value)} /></Field>
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => { try { repo.addAccount(an, ak, toMinor(ao || '0')); setAn(''); setAo(''); changed(); toast('Account added'); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } }}>Add account</button></div>
      <div className="row" style={{ alignItems: 'end' }}><Field label="New category"><input value={cn} onChange={(e) => setCn(e.target.value)} /></Field><Field label="Kind"><select value={ck} onChange={(e) => setCk(e.target.value as 'expense')}><option value="expense">Spending</option><option value="income">Income</option></select></Field>
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => { try { repo.addCategory(cn, ck); setCn(''); changed(); toast('Category added'); } catch { setErr('A category with that name already exists.'); } }}>Add category</button></div><p className="err" role="alert">{err}</p></Section>

    <Section title="Backup and moving"><p className="muted">A backup is the same encrypted file Tally keeps on this device. It opens only with your passphrase, on any device that runs Tally.</p>
      <div className="row"><button className="btn" onClick={backup}>Save encrypted backup</button></div></Section>

    <Section title="What this app does with the network"><p>Nothing. The page’s security policy forbids every outgoing connection (<code>connect-src 'none'</code>), there is no server, and the build contains no analytics or remote fonts. You can confirm it yourself: open your browser’s developer tools, go to Network, and use the app — the list stays empty after the first load.</p></Section>

    <Section title="Activity log" actions={<span className={`chip ${chain.ok ? 'ok' : 'bad'}`}>{chain.ok ? 'Chain intact' : `Tampering detected at entry ${chain.brokenAt}`}</span>}>
      <p className="muted small">Unlocks, imports, exports and checks are recorded. Each entry is linked to the one before, so edits or deletions show up here.</p>
      <div className="list small">{log.map((r) => <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}><span>{r.event.replace('.', ' ')} <span className="muted">{r.detail}</span></span><span className="muted">{r.ts.slice(0, 16).replace('T', ' ')}</span></div>)}</div></Section>

    <Section title="Danger zone"><p className="muted">Erase this profile from the device. Back up first if you might want it again.</p><button className="btn danger" onClick={() => setWipe(true)}>Erase this profile</button></Section>
    {pw && <PassModal onClose={() => setPw(false)} />}
    {wipe && <Modal title="Erase this profile?" onClose={() => setWipe(false)}><WipeBody onClose={() => setWipe(false)} /></Modal>}
  </div>;
  function WipeBody({ onClose }: { onClose: () => void }) { const [t, setT] = useState(''); return <><p>All transactions, receipts and settings in “{session.name}” will be overwritten and deleted.</p><Field label="Type DELETE to confirm"><input value={t} onChange={(e) => setT(e.target.value)} autoFocus /></Field><div className="row"><button className="btn danger" disabled={t !== 'DELETE'} onClick={async () => { const id = session.id; session.db.close(); await vaults.wipe(id); location.reload(); }}>Erase now</button><button className="btn quiet" onClick={onClose}>Keep it</button></div></>; }
}

function PassModal({ onClose }: { onClose: () => void }) {
  const { session, toast } = useApp(); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const c = checkPassphrase(a);
  async function go() { setErr(''); if (!c.ok) return setErr(c.hint); if (a !== b) return setErr('The two passphrases do not match.'); setBusy(true); try { await session.changePassphrase(a); toast('Passphrase changed'); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not change it'); } finally { setBusy(false); } }
  return <Modal title="Change passphrase" onClose={onClose}><Field label="New passphrase" hint={a ? c.hint : 'At least 12 characters'}><input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} autoFocus /></Field><Field label="Type it again"><input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field><p className="small muted">Older backups still open with the passphrase they were made with.</p><p className="err" role="alert">{err}</p><div className="row"><button className="btn" disabled={busy} onClick={go}>{busy ? 'Re-encrypting…' : 'Change passphrase'}</button><button className="btn quiet" onClick={onClose}>Cancel</button></div></Modal>;
}
void loadPrefs;
