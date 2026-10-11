import { useRef, useState } from 'react';
import { useApp } from './store';
import { Money, Section, Empty } from './ui';
import { parseInWorker } from './parse';
import { prepareReview, commitReview, flipRow, AlreadyImported, type ReviewRow } from '../core/ingest';
import type { ParsedStatement } from '../core/import/types';
import { reconcile } from '../core/reconcile';
import { formatMoney } from '../core/money';

export function ImportView() {
  const { repo, cat, changed, toast, go, refreshCat } = useApp(); const accts = repo.accounts(); const cats = repo.categories();
  const [acct, setAcct] = useState(accts[0]?.id ?? 0); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [parsed, setParsed] = useState<ParsedStatement | null>(null); const [rows, setRows] = useState<ReviewRow[]>([]); const bytes = useRef<Uint8Array>(new Uint8Array()); const [drag, setDrag] = useState(false);
  const [minConf, setMinConf] = useState(0);

  async function load(f: File) {
    setErr(''); setBusy(true); setParsed(null);
    try {
      const buf = await f.arrayBuffer(); bytes.current = new Uint8Array(buf.slice(0)); const res = await parseInWorker(f.name, buf);
      setParsed(res); setRows(prepareReview(repo, res, acct, cat));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read this file'); } finally { setBusy(false); }
  }
  const flip = (k: number) => setRows((r) => r.map((x) => (x.key === k ? flipRow(x, cat) : x)));
  const upd = (k: number, p: Partial<ReviewRow>) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...p } : x)));
  const accepted = rows.filter((r) => r.accept); const flagged = rows.filter((r) => r.confidence < 0.7 || r.dup !== 'none' || r.row.warnings?.length);
  // recomputed on every render so flips show immediately
  const sum = accepted.reduce((s, r) => s + r.row.amount, 0);
  const check = parsed && parsed.openingBalance != null && parsed.closingBalance != null ? parsed.openingBalance + rows.reduce((s, r) => s + r.row.amount, 0) - parsed.closingBalance : null;

  function save() {
    if (!parsed) return;
    try {
      const res = commitReview(repo, acct, rows, cat, { fileBytes: bytes.current, format: parsed.format, parsed }); refreshCat(); changed();
      let msg = `Added ${res.added} transaction${res.added === 1 ? '' : 's'}`;
      if (parsed.openingBalance != null && parsed.closingBalance != null && parsed.periodStart !== undefined) { try { const r = reconcile(repo, acct, parsed); msg += r.balanced ? '. Books match the statement.' : '. Books differ from the statement — see Check.'; } catch { /* no period */ } }
      toast(msg); setParsed(null); setRows([]); go('check');
    } catch (e) { setErr(e instanceof AlreadyImported ? e.message : e instanceof Error ? e.message : 'Could not save'); }
  }
  if (!accts.length) return <div className="sheet"><Empty title="Add an account first" body="Statements are imported into an account." /></div>;

  return <div className="sheet"><Section title="Import a statement">
    <p className="muted">PDF, CSV, OFX or QIF. The file is read on this device and never uploaded. You review everything before it is saved.</p>
    {!parsed && <><div className="field" style={{ maxWidth: 340 }}><label htmlFor="imp-acct"><span style={{ fontWeight: 600, fontSize: 14 }}>Into account</span></label><select id="imp-acct" value={acct} onChange={(e) => setAcct(+e.target.value)}>{accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <label className="panel" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); }} style={{ display: 'grid', placeItems: 'center', minHeight: 170, textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed', background: drag ? 'var(--wash)' : undefined }}>
        <span><strong>{busy ? 'Reading the file…' : 'Choose a file or drop it here'}</strong><br /><span className="muted small">Up to 25 MB. Scanned (image-only) PDFs need a CSV export instead.</span></span>
        <input type="file" className="sr" accept=".pdf,.csv,.ofx,.qfx,.qif,.txt,application/pdf,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
      {busy && <div className="skeleton" style={{ marginTop: 14, height: 42 }} aria-label="Reading file" />}
      <p className="err" role="alert" style={{ marginTop: 12 }}>{err}</p></>}

    {parsed && <>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="facts" style={{ marginTop: 0 }}>
          <div><div className="l">Rows found</div><div className="v">{rows.length}</div></div><div><div className="l">Will be added</div><div className="v">{accepted.length}</div></div>
          <div><div className="l">Net of those</div><div className="v"><Money v={sum} /></div></div>
          {check !== null && <div><div className="l">Statement check</div><div className={`v ${check === 0 ? 'ok' : 'err'}`} style={{ fontSize: 18 }}>{check === 0 ? 'Opening + rows = closing' : `Off by ${formatMoney(Math.abs(check))}`}</div></div>}
        </div>
        {parsed.warnings.map((w) => <p key={w} className="tag flag" style={{ marginTop: 10 }}>{w}</p>)}
        {parsed.skipped.length > 0 && <details style={{ marginTop: 10 }}><summary>{parsed.skipped.length} line{parsed.skipped.length > 1 ? 's' : ''} could not be read</summary><ul className="small">{parsed.skipped.slice(0, 50).map((s, i) => <li key={i}><span className="muted">Line {s.line}:</span> {s.reason} — <code>{s.text}</code></li>)}</ul></details>}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn small quiet" onClick={() => setRows((r) => r.map((x) => ({ ...x, accept: x.dup === 'none' && x.confidence >= minConf })))}>Accept all new</button><button className="btn small quiet" onClick={() => setRows((r) => r.map((x) => ({ ...x, accept: false })))}>Reject all</button>
        <button className="btn small quiet" onClick={() => setRows((r) => r.map((x) => ({ ...x, accept: x.dup === 'none' && x.confidence >= 0.9 })))}>Only the confident ones</button><button className="btn small quiet" onClick={() => setRows((r) => r.map((x) => flipRow(x, cat)))} title="Swap money in and money out on every row">Flip every row</button><span className="muted small">{flagged.length} flagged for a second look</span></div>
      <div className="tbl"><div className="hd" style={{ ['--cols' as string]: '24px 88px 1fr 150px 48px 108px 44px' }}><span /><span>Date</span><span>Description</span><span>Category</span><span>Sure</span><span className="r">Amount</span><span /></div>
        <div className="scroll">{rows.slice(0, 1500).map((r) => <div key={r.key} className="tr" style={{ ['--cols' as string]: '24px 88px 1fr 150px 48px 108px 44px', opacity: r.accept ? 1 : 0.55 }}>
          <input type="checkbox" aria-label={`Accept ${r.row.description}`} checked={r.accept} onChange={(e) => upd(r.key, { accept: e.target.checked })} />
          <span className="cell muted small">{r.row.date}</span>
          <span className="cell" title={`${r.row.description}${r.row.page ? ` — page ${r.row.page}, row ${r.row.line}` : ''}`}>{r.row.description}{r.dup === 'exact' && <span className="tag bad" style={{ marginLeft: 6 }}>already saved</span>}{r.dup === 'possible' && <span className="tag flag" style={{ marginLeft: 6 }}>looks like a duplicate</span>}{r.row.warnings?.map((w) => <span key={w} className="tag flag" style={{ marginLeft: 6 }} title={w}>check</span>)}</span>
          <span className="cell"><select aria-label={`Category for ${r.row.description}`} value={r.categoryId ?? ''} onChange={(e) => upd(r.key, { categoryId: e.target.value ? +e.target.value : null, remember: true })}><option value="">Uncategorized</option>{cats.filter((c) => c.kind !== 'transfer' && (r.row.amount < 0 ? c.kind === 'expense' : c.kind === 'income')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></span>
          <span className={`cell ${r.confidence < 0.7 ? 'err' : 'muted'}`}>{Math.round(r.confidence * 100)}%</span><span className="cell r"><Money v={r.row.amount} /></span><button className="link small" onClick={() => flip(r.key)} aria-label={`Flip direction of ${r.row.description}`} title="Swap money in and money out for this row">Flip</button></div>)}
        </div></div>
      {rows.length > 1500 && <p className="small muted">Showing the first 1,500 rows; the rest are included when you save.</p>}
      <p className="small muted" style={{ marginTop: 8 }}>When you change a category, Tally remembers that merchant for next time.</p>
      <p className="err" role="alert">{err}</p>
      <div className="row"><button className="btn" onClick={save} disabled={!accepted.length}>Save {accepted.length} transaction{accepted.length === 1 ? '' : 's'}</button><button className="btn quiet" onClick={() => { setParsed(null); setRows([]); setErr(''); }}>Cancel</button></div></>}
  </Section></div>;
}
