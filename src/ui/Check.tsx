import { useMemo, useState } from 'react';
import { useApp } from './store';
import { Section, Empty, Money } from './ui';
import { reconcile, auditReportHtml, type ReconResult } from '../core/reconcile';
import { findDuplicates, findGaps, findOutliers } from '../core/analytics';
import { formatMoney, toMinor } from '../core/money';
import { validIso } from '../core/dates';
import { download } from './boot';
import { logEvent } from '../core/audit';

export function CheckView() {
  const { repo, v, changed, toast } = useApp(); const accts = repo.accounts(); const [acct, setAcct] = useState(accts[0]?.id ?? 0);
  const stmts = useMemo(() => repo.db.all<{ id: number; period_start: string | null; period_end: string | null; opening_balance: number | null; closing_balance: number | null }>('SELECT id,period_start,period_end,opening_balance,closing_balance FROM statements WHERE account_id=? ORDER BY period_end DESC', [acct]), [repo, acct, v]);
  const [res, setRes] = useState<ReconResult | null>(null); const [err, setErr] = useState('');
  const [m, setM] = useState({ start: '', end: '', open: '', close: '' });
  const flags = useMemo(() => { const all = repo.list({ accountId: acct || undefined }); return [...findDuplicates(all), ...findOutliers(all), ...findGaps(all)]; }, [repo, acct, v]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const open = flags.filter((f) => !dismissed.has(f.message));
  function run(st: { openingBalance: number; closingBalance: number; periodStart: string; periodEnd: string }) { setErr(''); try { const r = reconcile(repo, acct, st); setRes(r); logEvent(repo.db, 'reconcile', `acct=${acct} balanced=${r.balanced}`); changed(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reconcile'); } }
  function manual() { if (!validIso(m.start) || !validIso(m.end)) return setErr('Set both dates.'); if (!m.open || !m.close) return setErr('Enter the opening and closing balances printed on the statement.'); run({ periodStart: m.start, periodEnd: m.end, openingBalance: toMinor(m.open), closingBalance: toMinor(m.close) }); }
  const name = accts.find((a) => a.id === acct)?.name ?? '';
  if (!accts.length) return <div className="sheet"><Empty title="No accounts" body="Add an account first." /></div>;
  return <div className="sheet">
    <Section title="Check against the bank" actions={<select aria-label="Account" value={acct} onChange={(e) => { setAcct(+e.target.value); setRes(null); }} style={{ width: 'auto' }}>{accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}>
      <p className="muted">Compare your books to a statement’s opening and closing balances. If they differ, Tally shows what could explain it.</p>
      {stmts.filter((s) => s.opening_balance != null && s.closing_balance != null && s.period_start && s.period_end).length > 0 && <div className="list">{stmts.filter((s) => s.opening_balance != null && s.closing_balance != null && s.period_start && s.period_end).map((s) => <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}><span>{s.period_start} to {s.period_end}</span><button className="btn quiet small" onClick={() => run({ periodStart: s.period_start!, periodEnd: s.period_end!, openingBalance: s.opening_balance!, closingBalance: s.closing_balance! })}>Check this statement</button></div>)}</div>}
      <details style={{ marginTop: 12 }} open={stmts.length === 0}><summary>Check using numbers from a paper or online statement</summary>
        <div className="grid2" style={{ marginTop: 10 }}><label className="field"><span>Period start</span><input type="date" value={m.start} onChange={(e) => setM({ ...m, start: e.target.value })} /></label><label className="field"><span>Period end</span><input type="date" value={m.end} onChange={(e) => setM({ ...m, end: e.target.value })} /></label>
          <label className="field"><span>Opening balance (₦)</span><input inputMode="decimal" value={m.open} onChange={(e) => setM({ ...m, open: e.target.value })} /></label><label className="field"><span>Closing balance (₦)</span><input inputMode="decimal" value={m.close} onChange={(e) => setM({ ...m, close: e.target.value })} /></label></div>
        <button className="btn" onClick={manual}>Check</button></details>
      <p className="err" role="alert">{err}</p>
      {res && <div className="panel" style={{ marginTop: 16 }} aria-live="polite">
        <h3 className={res.balanced ? 'ok' : 'err'}>{res.balanced ? 'Balanced. Your books match this statement.' : `Not balanced. Off by ${formatMoney(Math.abs(res.closingDelta || res.openingDelta))}.`}</h3>
        <div className="facts"><div><div className="l">Statement closes at</div><div className="v"><Money v={res.statementClosing} plain /></div></div><div><div className="l">Your books say</div><div className="v"><Money v={res.statementOpening + res.periodNet} plain /></div></div><div><div className="l">Matched rows</div><div className="v">{res.matched.length}</div></div></div>
        {res.explanations.length > 0 && <ul>{res.explanations.map((e) => <li key={e}>{e}</li>)}</ul>}
        {res.unmatchedBook.length > 0 && <details><summary>{res.unmatchedBook.length} in your books but not on the statement</summary><ul className="small">{res.unmatchedBook.slice(0, 100).map((t) => <li key={t.id}>{t.date} {t.description} <Money v={t.amount} /></li>)}</ul></details>}
        <button className="btn quiet" style={{ marginTop: 12 }} onClick={() => { download(`audit-${name.replace(/\W+/g, '-')}-${res.period.end}.html`, auditReportHtml(name, res), 'text/html'); logEvent(repo.db, 'export', 'audit report'); changed(); toast('Report saved. Open it and print to PDF if you need one.'); }}>Download audit report</button></div>}
    </Section>
    <Section title="Things to look at"><p className="muted small">Possible double entries, unusually large spending, and long quiet stretches that may mean a missing statement.</p>
      {open.length === 0 ? <Empty title="Nothing flagged" body="No duplicates, outliers or gaps found in this account." /> : <div className="list">{open.slice(0, 60).map((f) => <div key={f.message} className="row" style={{ justifyContent: 'space-between' }}><span><span className={`tag ${f.severity === 'warn' ? 'flag' : ''}`}>{f.kind === 'duplicate' ? 'Possible duplicate' : f.kind === 'outlier' ? 'Unusual' : 'Quiet stretch'}</span> {f.message}</span>
        <span className="row">{f.kind === 'duplicate' && <button className="btn quiet small" onClick={() => { repo.deleteTx([f.txIds[1]]); changed(); toast('Removed the second entry'); }}>Remove the second</button>}<button className="btn quiet small" onClick={() => setDismissed(new Set([...dismissed, f.message]))}>It’s fine</button></span></div>)}</div>}
    </Section></div>;
}
