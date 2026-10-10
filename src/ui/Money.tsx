import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './store';
import { Money, Drawer, Modal, Field, Empty, Section } from './ui';
import { toMinor, formatMoney, parseAmount } from '../core/money';
import { RepoError, type Tx } from '../core/repo';
import { learnCorrection } from '../core/ingest';
import { validIso } from '../core/dates';
import { download } from './boot';
import { toCsv } from '../core/import/csv';

const rowH = () => ({ compact: 34, cozy: 44, roomy: 54 }[document.documentElement.dataset.density as 'cozy'] ?? 44);

export function MoneyView() {
  const { repo, v, changed, toast, cat, openAdd, openTransfer, filterCat, setFilterCat } = useApp();
  const [q, setQ] = useState(''); const [acct, setAcct] = useState(0); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set()); const [edit, setEdit] = useState<number | null>(null); const [top, setTop] = useState(0); const [narrow, setNarrow] = useState(innerWidth < 720);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = () => setNarrow(innerWidth < 720); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  const cats = useMemo(() => repo.categories(), [repo, v]); const accts = useMemo(() => repo.accounts(), [repo, v]);
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]); const acctName = useMemo(() => new Map(accts.map((a) => [a.id, a.name])), [accts]);
  const rows = useMemo(() => repo.list({ q: q.trim() || undefined, accountId: acct || undefined, categoryId: filterCat || undefined, from: validIso(from) ? from : undefined, to: validIso(to) ? to : undefined }), [repo, v, q, acct, filterCat, from, to]);
  const H = rowH(); const vis = Math.ceil(560 / H) + 8; const start = Math.max(0, Math.floor(top / H) - 4); const slice = rows.slice(start, start + vis);
  const cols = narrow ? '28px 1fr 110px' : '28px 96px 1fr 180px 140px 130px';
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...sel];

  function setCategory(id: number, c: number | null) { repo.setCategory([id], c); if (c) learnCorrection(repo, cat, id, c, false); changed(); }
  function bulkCat(c: number) { repo.setCategory(ids, c); ids.forEach((i) => learnCorrection(repo, cat, i, c, false)); setSel(new Set()); changed(); toast(`${ids.length} moved to ${catName.get(c)}`); }
  function bulkDelete() { if (!confirm(`Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return; repo.deleteTx(ids); setSel(new Set()); changed(); toast('Deleted'); }
  function exportCsv() { download('transactions.csv', toCsv([['Date', 'Account', 'Description', 'Category', 'Amount', 'Tags', 'Notes'], ...rows.map((t) => [t.date, acctName.get(t.account_id) ?? '', t.description, catName.get(t.category_id ?? -1) ?? '', (t.amount / 100).toFixed(2), t.tags, t.notes])]), 'text/csv'); toast(`Exported ${rows.length} rows`); }

  if (!repo.count() && !q) return <div className="sheet"><Section title="Money" actions={<><button className="btn" onClick={openAdd}>Add a transaction</button></>}><Empty title="No transactions yet" body="Add one by hand, or import a bank statement to fill this in." /></Section></div>;
  return <div className="sheet">
    <Section title="Money" actions={<><button className="btn" onClick={openAdd}>Add</button><button className="btn quiet" onClick={openTransfer}>Move between accounts</button><button className="btn quiet" onClick={exportCsv}>Export CSV</button></>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="grow" aria-label="Search transactions" placeholder="Search description, notes, tags" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Account" value={acct} onChange={(e) => setAcct(+e.target.value)} style={{ width: 'auto' }}><option value={0}>All accounts</option>{accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select aria-label="Category" value={filterCat ?? 0} onChange={(e) => setFilterCat(+e.target.value || null)} style={{ width: 'auto' }}><option value={0}>All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /><input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
      </div>
      {sel.size > 0 && <div className="bulk" role="region" aria-label="Bulk actions"><strong>{sel.size} selected</strong>
        <select aria-label="Move to category" value="" onChange={(e) => e.target.value && bulkCat(+e.target.value)}><option value="">Move to category…</option>{cats.filter((c) => c.kind !== 'transfer').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn danger small" onClick={bulkDelete}>Delete</button><button className="btn quiet small" style={{ color: 'inherit', borderColor: 'currentColor' }} onClick={() => setSel(new Set())}>Clear</button></div>}
      <div className="tbl" role="table" aria-label="Transactions" aria-rowcount={rows.length}>
        <div className="head" role="row" style={{ ['--cols' as string]: cols }}><span role="columnheader"><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && sel.size >= Math.min(rows.length, 500)} onChange={(e) => setSel(e.target.checked ? new Set(rows.slice(0, 500).map((r) => r.id)) : new Set())} /></span><span role="columnheader">Date</span><span role="columnheader">Description</span>{!narrow && <><span role="columnheader">Category</span><span role="columnheader">Account</span></>}<span role="columnheader" className="r">Amount</span></div>
        <div className="scroll" ref={box} onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)} tabIndex={0} aria-label="Transaction list">
          {rows.length === 0 ? <Empty title="Nothing matches" body="Try a different search or clear the filters." /> :
            <div style={{ height: rows.length * H, position: 'relative' }}><div style={{ position: 'absolute', top: start * H, left: 0, right: 0 }}>
              {slice.map((t, i) => <Row key={t.id} t={t} idx={start + i} cols={cols} narrow={narrow} sel={sel.has(t.id)} toggle={toggle} cats={cats} catName={catName.get(t.category_id ?? -1)} acct={acctName.get(t.account_id) ?? ''} onCat={setCategory} onOpen={() => setEdit(t.id)} />)}
            </div></div>}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>{rows.length.toLocaleString('en-NG')} transaction{rows.length === 1 ? '' : 's'}. Tip: <kbd>Ctrl</kbd> <kbd>K</kbd> opens quick actions.</p>
    </Section>
    {edit !== null && <TxDrawer id={edit} onClose={() => setEdit(null)} />}
  </div>;
}

function Row(p: { t: Tx; idx: number; cols: string; narrow: boolean; sel: boolean; toggle: (id: number) => void; cats: { id: number; name: string; kind: string }[]; catName?: string; acct: string; onCat: (id: number, c: number | null) => void; onOpen: () => void }) {
  const { t } = p; const low = t.confidence !== null && t.confidence < 0.7;
  return <div className="tr" role="row" aria-rowindex={p.idx + 2} aria-selected={p.sel} style={{ ['--cols' as string]: p.cols }}>
    <span role="cell"><input type="checkbox" aria-label={`Select ${t.description}`} checked={p.sel} onChange={() => p.toggle(t.id)} /></span>
    {!p.narrow && <span role="cell" className="cell">{t.date}</span>}
    <span role="cell" className="cell"><button className="btn quiet small" style={{ border: 0, padding: 0, minHeight: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={p.onOpen} title={t.description}>{p.narrow && <span className="muted small">{t.date} </span>}{t.description}</button>{t.is_split ? <span className="chip" style={{ marginLeft: 6 }}>split</span> : null}{low ? <span className="chip review" style={{ marginLeft: 6 }} title="The importer was unsure about this one">check</span> : null}</span>
    {!p.narrow && <><span role="cell" className="cell">{t.transfer_group ? <span className="chip">Transfer</span> : t.is_split ? <span className="muted">Several</span> : <select aria-label={`Category for ${t.description}`} value={t.category_id ?? ''} onChange={(e) => p.onCat(t.id, e.target.value ? +e.target.value : null)}><option value="">Uncategorized</option>{p.cats.filter((c) => c.kind !== 'transfer' && (t.amount < 0 ? c.kind === 'expense' : c.kind === 'income')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</span><span role="cell" className="cell muted">{p.acct}</span></>}
    <span role="cell" className="cell r"><Money v={t.amount} /></span>
  </div>;
}

export function TxDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { repo, changed, toast, cat, today } = useApp(); const tx = id ? repo.db.one<Tx>('SELECT * FROM transactions WHERE id=?', [id]) : undefined;
  const accts = repo.accounts(), cats = repo.categories();
  const [kind, setKind] = useState<'out' | 'in'>(tx ? (tx.amount >= 0 ? 'in' : 'out') : 'out'); const [amount, setAmount] = useState(tx ? String(Math.abs(tx.amount) / 100) : '');
  const [date, setDate] = useState(tx?.date ?? today); const [desc, setDesc] = useState(tx?.description ?? ''); const [account, setAccount] = useState(tx?.account_id ?? accts[0]?.id ?? 0);
  const [catId, setCatId] = useState<number | ''>(tx?.category_id ?? ''); const [tags, setTags] = useState(tx?.tags ?? ''); const [notes, setNotes] = useState(tx?.notes ?? ''); const [remember, setRemember] = useState(false);
  const [err, setErr] = useState(''); const [parts, setParts] = useState<{ category_id: number | ''; amount: string }[] | null>(null);
  const isTransfer = !!tx?.transfer_group; const signed = (kind === 'out' ? -1 : 1) * (parseAmount(amount) ?? NaN);
  const att = tx?.attachment_hash ? repo.attachment(tx.attachment_hash) : undefined;

  function suggest() { if (desc.trim() && !catId && Number.isFinite(signed)) { const s = cat.suggest(desc, signed); if (s.categoryId && s.via !== 'none') setCatId(s.categoryId); } }
  function save() {
    setErr('');
    try {
      if (!Number.isFinite(signed) || signed === 0) throw new RepoError('Enter an amount greater than zero.');
      if (tx) { repo.updateTx(tx.id, { account_id: account, date, amount: isTransfer ? undefined : signed, description: desc, category_id: catId || null, tags, notes }); if (catId && catId !== tx.category_id) learnCorrection(repo, cat, tx.id, +catId, remember); }
      else repo.addTx({ account_id: account, date, amount: signed, description: desc, category_id: catId || null, tags, notes });
      changed(); toast(tx ? 'Saved' : 'Added'); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  }
  function del() { if (tx && confirm('Delete this transaction?')) { repo.deleteTx([tx.id]); changed(); toast('Deleted'); onClose(); } }
  function saveSplits() {
    if (!tx || !parts) return; setErr('');
    try { repo.setSplits(tx.id, parts.map((p) => ({ category_id: p.category_id || null, amount: (tx.amount < 0 ? -1 : 1) * Math.abs(toMinor(p.amount || '0')) }))); changed(); toast('Split saved'); setParts(null); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not split'); }
  }
  async function pick(f: File) { if (!tx) return; try { repo.attach(tx.id, f.name, f.type, new Uint8Array(await f.arrayBuffer())); changed(); toast('Receipt attached'); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not attach'); } }
  const used = parts ? parts.reduce((s, p) => s + Math.abs(toMinor(p.amount || '0')), 0) : 0; const left = tx ? Math.abs(tx.amount) - used : 0;

  return <Drawer title={tx ? 'Edit transaction' : 'Add a transaction'} onClose={onClose}>
    {isTransfer && <p className="chip review">This is one side of a transfer. You can change its date and notes; delete removes both sides.</p>}
    {!parts && <><div className="row" role="radiogroup" aria-label="Direction" style={{ marginBottom: 12 }}>
      <button className={`btn small ${kind === 'out' ? '' : 'quiet'}`} role="radio" aria-checked={kind === 'out'} disabled={isTransfer} onClick={() => setKind('out')}>Money out</button><button className={`btn small ${kind === 'in' ? '' : 'quiet'}`} role="radio" aria-checked={kind === 'in'} disabled={isTransfer} onClick={() => setKind('in')}>Money in</button></div>
    <div className="grid2"><Field label="Amount (₦)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isTransfer} autoFocus={!tx} /></Field><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    <Field label="Description"><input value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={suggest} maxLength={500} /></Field>
    <div className="grid2"><Field label="Account"><select value={account} onChange={(e) => setAccount(+e.target.value)}>{accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Category"><select value={catId} onChange={(e) => setCatId(e.target.value ? +e.target.value : '')} disabled={isTransfer || !!tx?.is_split}><option value="">Uncategorized</option>{cats.filter((c) => c.kind !== 'transfer' && (kind === 'out' ? c.kind === 'expense' : c.kind === 'income')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
    {tx && catId && catId !== tx.category_id && <label className="row small" style={{ marginBottom: 12 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Always use this category for “{desc.slice(0, 30)}”</label>}
    <Field label="Tags" hint="Separate with commas"><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field><Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
    {tx && <Field label="Receipt" hint="PNG, JPEG, WebP, GIF or PDF up to 3 MB. Stored encrypted with everything else.">{att ? <div className="row"><span className="chip">{att.name}</span><button className="btn quiet small" onClick={() => download(att.name, att.data, att.mime)}>Download</button><button className="btn quiet small" onClick={() => { repo.detach(tx.id); changed(); }}>Remove</button></div> : <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />}</Field>}</>}
    {parts && tx && <div><p>Total <strong>{formatMoney(tx.amount)}</strong>. Divide it between categories; the parts must add up exactly.</p>
      {parts.map((p, i) => <div className="row" key={i} style={{ marginBottom: 8 }}><select aria-label={`Part ${i + 1} category`} value={p.category_id} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, category_id: e.target.value ? +e.target.value : '' } : x)))} style={{ flex: 1 }}><option value="">Uncategorized</option>{cats.filter((c) => c.kind === (tx.amount < 0 ? 'expense' : 'income')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input aria-label={`Part ${i + 1} amount`} inputMode="decimal" value={p.amount} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} style={{ width: 130 }} />{parts.length > 2 && <button className="btn quiet small" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="Remove part">Remove</button>}</div>)}
      <button className="btn quiet small" onClick={() => setParts([...parts, { category_id: '', amount: left > 0 ? String(left / 100) : '' }])}>Add a part</button>
      <p className={left === 0 ? 'ok' : 'err'} aria-live="polite">{left === 0 ? 'Adds up.' : left > 0 ? `${formatMoney(left)} left to assign.` : `${formatMoney(-left)} too much.`}</p></div>}
    <p className="err" role="alert">{err}</p>
    <div className="row">{!parts ? <><button className="btn" onClick={save}>Save</button>{tx && !isTransfer && <button className="btn quiet" onClick={() => setParts(tx.is_split ? repo.splits(tx.id).map((s) => ({ category_id: s.category_id ?? '', amount: String(Math.abs(s.amount) / 100) })) : [{ category_id: tx.category_id ?? '', amount: String(Math.abs(tx.amount) / 100) }, { category_id: '', amount: '' }])}>Split</button>}{tx && <button className="btn quiet" onClick={del} style={{ marginLeft: 'auto', color: 'var(--zobo)' }}>Delete</button>}</>
      : <><button className="btn" disabled={left !== 0} onClick={saveSplits}>Save split</button><button className="btn quiet" onClick={() => setParts(null)}>Back</button></>}</div>
  </Drawer>;
}

export function TransferModal({ onClose }: { onClose: () => void }) {
  const { repo, changed, toast, today } = useApp(); const a = repo.accounts(); const [from, setFrom] = useState(a[0]?.id ?? 0); const [to, setTo] = useState(a[1]?.id ?? 0); const [amt, setAmt] = useState(''); const [date, setDate] = useState(today); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  if (a.length < 2) return <Modal title="Move money between accounts" onClose={onClose}><p>You need at least two accounts. Add another one in Safe first.</p><button className="btn" onClick={onClose}>OK</button></Modal>;
  const go = () => { try { repo.addTransfer(from, to, Math.abs(toMinor(amt || '0')), date, note); changed(); toast('Transfer recorded'); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not transfer'); } };
  return <Modal title="Move money between accounts" onClose={onClose}><p className="muted small">Transfers change balances but are not counted as income or spending.</p>
    <div className="grid2"><Field label="From"><select value={from} onChange={(e) => setFrom(+e.target.value)}>{a.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="To"><select value={to} onChange={(e) => setTo(+e.target.value)}>{a.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Amount (₦)"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus /></Field><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field><p className="err" role="alert">{err}</p><div className="row"><button className="btn" onClick={go}>Move money</button><button className="btn quiet" onClick={onClose}>Cancel</button></div></Modal>;
}
