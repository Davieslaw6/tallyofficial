import { useEffect, useState } from 'react';
import { vaults, bootEngine, download } from './boot';
import { checkPassphrase, VaultError } from '../core/crypto';
import { toMinor } from '../core/money';
import { Repo } from '../core/repo';
import { loadSample } from '../core/sample';
import { todayIso } from '../core/dates';
import { Modal, Field, Logo } from './ui';
import type { ProfileInfo, Session } from '../core/vault';

type Mode = 'loading' | 'pick' | 'unlock' | 'create' | 'account' | 'restore';
export type Landing = 'today' | 'import' | 'money';

export function Gate({ onOpen }: { onOpen: (s: Session, landing: Landing) => void }) {
  const [mode, setMode] = useState<Mode>('loading'); const [profiles, setProfiles] = useState<ProfileInfo[]>([]); const [sel, setSel] = useState<ProfileInfo | null>(null);
  const [name, setName] = useState('Personal'); const [pass, setPass] = useState(''); const [pass2, setPass2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0); const [wait, setWait] = useState(0); const [sess, setSess] = useState<Session | null>(null); const [forget, setForget] = useState(false); const [confirm, setConfirm] = useState('');
  const [acctName, setAcctName] = useState(''); const [acctKind, setAcctKind] = useState('checking'); const [opening, setOpening] = useState('');

  useEffect(() => { bootEngine().then(() => vaults.list()).then((p) => { setProfiles(p); if (!p.length) setMode('create'); else if (p.length === 1) { setSel(p[0]); setMode('unlock'); } else setMode('pick'); }).catch(() => setErr('This browser blocked local storage, so Tally cannot keep a private vault. Check that private browsing is off.')); }, []);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const strength = checkPassphrase(pass);
  async function unlock(e: React.FormEvent) {
    e.preventDefault(); if (!sel || busy || wait > 0) return; setBusy(true); setErr('');
    try { const s = await vaults.unlock(sel.id, pass); setPass(''); onOpen(s, 'today'); }
    catch (x) { const n = fails + 1; setFails(n); if (n >= 3) setWait(Math.min(60, 2 ** (n - 2))); setErr(x instanceof VaultError && x.code === 'bad-passphrase' ? 'Wrong passphrase. It is case-sensitive.' : x instanceof VaultError ? x.message : 'Could not open this vault.'); }
    finally { setBusy(false); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!name.trim()) return setErr('Give this profile a name.'); if (!strength.ok) return setErr(strength.hint); if (pass !== pass2) return setErr('The two passphrases do not match.');
    setBusy(true); try { setSess(await vaults.create(name.trim(), pass)); setMode('account'); setPass(''); setPass2(''); } catch (x) { setErr(x instanceof Error ? x.message : 'Could not create the vault'); } finally { setBusy(false); }
  }
  function finish(landing: Landing | 'sample') {
    if (!sess) return; const repo = new Repo(sess.db);
    try {
      if (landing === 'sample') { loadSample(repo, todayIso()); } else { if (!acctName.trim()) return setErr('Name your first account, for example "GTBank current".'); repo.addAccount(acctName, acctKind, toMinor(opening || '0'), null); }
    } catch (x) { return setErr(x instanceof Error ? x.message : 'Could not add the account'); }
    sess.touch(0); void sess.flush(); onOpen(sess, landing === 'sample' ? 'today' : landing);
  }
  async function restore(f: File) {
    setErr(''); try { const id = await vaults.importArchive(f.name.replace(/\.tally$/, '') || 'Restored', new Uint8Array(await f.arrayBuffer())); const p = await vaults.list(); setProfiles(p); setSel(p.find((x) => x.id === id)!); setMode('unlock'); } catch { setErr('That file is not a Tally backup.'); }
  }
  async function wipe() { if (!sel || confirm !== 'DELETE') return; await vaults.wipe(sel.id); const p = await vaults.list(); setProfiles(p); setForget(false); setConfirm(''); setSel(null); setMode(p.length ? 'pick' : 'create'); }

  return <main className="gate"><div className="card">
    <div className="brand" style={{ padding: 0, marginBottom: 18 }}><Logo /> Tally</div>
    {mode === 'loading' && !err && <div className="skeleton" style={{ height: 120 }} aria-label="Loading" />}
    {err && mode === 'loading' && <p className="err" role="alert">{err}</p>}

    {mode === 'pick' && <><h1>Whose notebook?</h1><p className="muted">Each profile has its own passphrase and its own encrypted file.</p>
      <div className="profiles">{profiles.map((p) => <button key={p.id} className="btn quiet" onClick={() => { setSel(p); setMode('unlock'); setErr(''); }}>{p.name}</button>)}</div>
      <div className="row"><button className="btn quiet small" onClick={() => { setMode('create'); setErr(''); }}>New profile</button><label className="btn quiet small" style={{ cursor: 'pointer' }}>Restore a backup<input type="file" accept=".tally" className="sr" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label></div></>}

    {mode === 'unlock' && sel && <form onSubmit={unlock}><h1>{sel.name}</h1><p className="muted">Enter your passphrase to open this notebook. Nothing leaves this device.</p>
      <Field label="Passphrase"><input type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={!!err} aria-describedby="gate-err" /></Field>
      <p id="gate-err" className="err" role="alert" aria-live="polite">{err}{wait > 0 && ` Try again in ${wait}s.`}</p>
      <div className="row"><button className="btn" disabled={busy || wait > 0 || !pass}>{busy ? 'Opening…' : 'Unlock'}</button>
        {profiles.length > 1 && <button type="button" className="btn quiet" onClick={() => { setMode('pick'); setPass(''); setErr(''); }}>Switch profile</button>}
        <button type="button" className="btn quiet" onClick={() => setMode('create')}>New profile</button></div>
      <p className="small muted" style={{ marginTop: 18 }}>Forgot it? There is no reset — that is what keeps the data private. You can <button type="button" className="btn quiet small" onClick={() => setForget(true)}>erase this profile</button> or restore a backup.</p></form>}

    {mode === 'create' && <form onSubmit={create}><div className="steps" aria-hidden><i className="on" /><i /><i /></div><h1>Make a private notebook</h1><p className="muted">Your data is encrypted with a key made from your passphrase. Only you can open it.</p>
      <Field label="Profile name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
      <Field label="Passphrase" hint="Use 12 or more characters. Four unrelated words work well."><input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></Field>
      <div className="strength" aria-hidden><i style={{ width: `${(strength.score / 4) * 100}%` }} /></div><p className={`small ${strength.ok ? 'ok' : 'muted'}`} aria-live="polite">{pass ? strength.hint : ''}</p>
      <Field label="Type it again"><input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></Field>
      <p className="small muted">If you forget this passphrase, nobody can recover your data — not even us. Keep a backup somewhere safe.</p>
      <p className="err" role="alert">{err}</p>
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Locking it up…' : 'Create notebook'}</button>
        {profiles.length > 0 && <button type="button" className="btn quiet" onClick={() => { setMode(profiles.length > 1 ? 'pick' : 'unlock'); setErr(''); }}>Cancel</button>}
        {profiles.length === 0 && <label className="btn quiet" style={{ cursor: 'pointer' }}>Restore a backup<input type="file" accept=".tally" className="sr" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>}</div></form>}

    {mode === 'account' && <div><div className="steps" aria-hidden><i className="on" /><i className="on" /><i /></div><h1>Add your first account</h1><p className="muted">You can add more later. Opening balance is what the account held before your first transaction.</p>
      <Field label="Account name"><input value={acctName} onChange={(e) => setAcctName(e.target.value)} placeholder="GTBank current" autoFocus /></Field>
      <div className="grid2"><Field label="Type"><select value={acctKind} onChange={(e) => setAcctKind(e.target.value)}><option value="checking">Current / checking</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="cash">Cash</option><option value="investment">Investment</option></select></Field>
        <Field label="Opening balance (₦)"><input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></Field></div>
      <p className="err" role="alert">{err}</p>
      <div className="row"><button className="btn" onClick={() => finish('import')}>Import a statement</button><button className="btn quiet" onClick={() => finish('money')}>Add transactions by hand</button></div>
      <p className="small muted" style={{ marginTop: 16 }}>Just looking around? <button className="btn quiet small" onClick={() => finish('sample')}>Fill with sample data</button> (clearly labelled, fake).</p></div>}

    {mode !== 'loading' && mode !== 'account' && err && mode === 'pick' && <p className="err" role="alert">{err}</p>}
  </div>
  {forget && sel && <Modal title={`Erase “${sel.name}”?`} onClose={() => setForget(false)}>
    <p>This overwrites the encrypted file and removes the profile. It cannot be undone, and without the passphrase the data cannot be read anyway.</p>
    <Field label='Type DELETE to confirm'><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></Field>
    <div className="row"><button className="btn danger" disabled={confirm !== 'DELETE'} onClick={wipe}>Erase profile</button><button className="btn quiet" onClick={() => setForget(false)}>Keep it</button></div></Modal>}
  </main>;
}
void download;
