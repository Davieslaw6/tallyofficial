import { useState } from 'react';
import { vaults } from './boot';
import { toMinor } from '../core/money';
import { Repo } from '../core/repo';
import { loadSample } from '../core/sample';
import { todayIso } from '../core/dates';
import { Field, Logo } from './ui';
import type { Session } from '../core/vault';

export type Landing = 'today' | 'import' | 'money';

/** First-run setup: one account, then straight in. No passphrase, no profiles. */
export function Welcome({ session, onDone }: { session: Session; onDone: (l: Landing) => void }) {
  const [name, setName] = useState(''); const [kind, setKind] = useState('checking'); const [opening, setOpening] = useState(''); const [err, setErr] = useState('');
  function go(landing: Landing | 'sample') {
    const repo = new Repo(session.db); setErr('');
    try {
      if (landing === 'sample') loadSample(repo, todayIso()); else { if (!name.trim()) return setErr('Name your first account, for example “GTBank current”.'); repo.addAccount(name, kind, toMinor(opening || '0'), null); }
    } catch (e) { return setErr(e instanceof Error ? e.message : 'Could not add the account'); }
    session.touch(0); void session.flush(); onDone(landing === 'sample' ? 'today' : landing);
  }
  async function restore(f: File) { try { await vaults.restorePlain(session.id, new Uint8Array(await f.arrayBuffer())); location.reload(); } catch { setErr('That file is not a Tally backup.'); } }
  return <main className="welcome">
    <div className="brand"><Logo /> Tally</div>
    <h1>Add your first account</h1>
    <p className="quiet">Tally keeps your money in this browser and never connects to the internet. Opening balance is what the account held before your first transaction.</p>
    <div style={{ marginTop: 22 }}>
      <Field label="Account name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="GTBank current" autoFocus /></Field>
      <div className="grid2"><Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="checking">Current</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="cash">Cash</option><option value="investment">Investment</option></select></Field>
        <Field label="Opening balance (₦)"><input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></Field></div>
    </div>
    <p className="err" role="alert">{err}</p>
    <div className="row"><button className="btn" onClick={() => go('import')}>Import a statement</button><button className="btn quiet" onClick={() => go('money')}>Add transactions by hand</button></div>
    <p className="small quiet" style={{ marginTop: 28 }}>Just looking? <button className="link" onClick={() => go('sample')}>Fill with sample data</button> (fake figures). Moving from another device? <label className="link" style={{ cursor: 'pointer' }}>Restore a backup<input type="file" accept=".tally" className="sr" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label></p>
  </main>;
}
