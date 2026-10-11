import { useState } from 'react';
import { useApp } from './store';
import { Section, Money, Empty, Field } from './ui';
import { budgetStatus, detectSubscriptions } from '../core/analytics';
import { toMinor, formatMoney } from '../core/money';
import { diffDays, addDays, monthRange, shiftMonth } from '../core/dates';

export function PlanView() {
  const { repo, month, changed, toast, today } = useApp(); const cats = repo.categories().filter((c) => c.kind === 'expense'); const accts = repo.accounts();
  const [bc, setBc] = useState(cats[0]?.id ?? 0); const [bl, setBl] = useState(''); const [gn, setGn] = useState(''); const [gt, setGt] = useState(''); const [gd, setGd] = useState('');
  const [rd, setRd] = useState(''); const [ra, setRa] = useState(''); const [rf, setRf] = useState('monthly'); const [rn, setRn] = useState(today); const [rk, setRk] = useState<'out' | 'in'>('out'); const [err, setErr] = useState('');
  const bud = budgetStatus(repo, month); const goals = repo.goals(); const rec = repo.recurring(); const due = repo.dueRecurring(today); const subs = detectSubscriptions(repo.list({ from: addDays(today, -420) }));
  const guard = (f: () => void) => { setErr(''); try { f(); changed(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); } };
  // rule-based suggestion: average of the 3 previous full months, rounded up to the nearest ₦1,000
  const avg3 = (cid: number) => { let tot = 0; for (let i = 1; i <= 3; i++) { const [a, b] = monthRange(shiftMonth(month, -i)); tot += repo.byCategory(a, b).find((x) => x.category_id === cid)?.total ?? 0; } return Math.ceil(tot / 3 / 100000) * 100000; };
  const sug = bc ? avg3(bc) : 0;

  return <div className="sheet">
    <p className="err" role="alert">{err}</p>
    {due.length > 0 && <div className="answer"><strong>{due.length} recurring item{due.length > 1 ? 's are' : ' is'} due.</strong> <button className="btn small" onClick={() => { let n = 0; due.forEach((d) => (n += repo.generateRecurring(d.id, today))); changed(); toast(`Added ${n} transaction${n === 1 ? '' : 's'}`); }}>Add them now</button></div>}
    <Section title="Budgets">
      {bud.length === 0 ? <Empty title="No budgets yet" body="Set a monthly limit for a category and Tally will warn you as you approach it." /> : <div className="list">{bud.map((b) => <div key={b.categoryId}><div className="row" style={{ justifyContent: 'space-between' }}><strong>{b.name}</strong><span><Money v={-b.spent} plain /> of <Money v={b.limit} plain /> <button className="btn quiet small" onClick={() => guard(() => repo.deleteBudget(b.categoryId))} aria-label={`Remove ${b.name} budget`}>Remove</button></span></div>
        <div className={`meter ${b.state}`} role="progressbar" aria-valuenow={Math.round(b.ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.name} budget used`}><i style={{ width: `${Math.min(100, b.ratio * 100)}%` }} /></div>
        <div className="small muted">{b.state === 'over' ? `${formatMoney(b.spent - b.limit)} over` : `${formatMoney(b.limit - b.spent)} left`}</div></div>)}</div>}
      <div className="row" style={{ marginTop: 14, alignItems: 'end' }}><Field label="Category"><select value={bc} onChange={(e) => setBc(+e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Monthly limit (₦)" hint={sug > 0 ? `Your last 3 months average about ${formatMoney(sug)}` : undefined}><input inputMode="decimal" value={bl} onChange={(e) => setBl(e.target.value)} /></Field>
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => guard(() => { repo.setBudget(bc, toMinor(bl || '0')); setBl(''); })}>Set budget</button>{sug > 0 && <button className="btn quiet" style={{ marginBottom: 14 }} onClick={() => setBl(String(sug / 100))}>Use that</button>}</div></Section>

    <Section title="Goals">
      {goals.length === 0 ? <Empty title="No goals yet" body="Name something you are saving for and a date, and Tally shows how much to set aside each month." /> : <div className="list">{goals.map((g) => { const left = Math.max(0, g.target_amount - g.saved); const months = g.target_date ? Math.max(1, Math.ceil(diffDays(g.target_date, today) / 30)) : 0; return <div key={g.id}><div className="row" style={{ justifyContent: 'space-between' }}><strong>{g.name}</strong><span><Money v={g.saved} plain /> of <Money v={g.target_amount} plain /></span></div>
        <div className="meter" role="progressbar" aria-valuenow={Math.round((g.saved / g.target_amount) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} progress`}><i style={{ width: `${Math.min(100, (g.saved / g.target_amount) * 100)}%`, background: 'var(--in)' }} /></div>
        <div className="row small muted" style={{ justifyContent: 'space-between' }}><span>{g.target_date ? (months && left > 0 ? `${formatMoney(Math.ceil(left / months))} a month to reach it by ${g.target_date}` : left === 0 ? 'Reached' : `Target date ${g.target_date} has passed`) : 'No date set'}</span>
          <span className="row"><button className="btn quiet small" onClick={() => { const a = prompt('Add how much (₦)?'); if (a) guard(() => repo.contributeGoal(g.id, toMinor(a))); }}>Add money</button><button className="btn quiet small" onClick={() => guard(() => repo.deleteGoal(g.id))}>Remove</button></span></div></div>; })}</div>}
      <div className="row" style={{ marginTop: 14, alignItems: 'end' }}><Field label="Goal"><input value={gn} onChange={(e) => setGn(e.target.value)} placeholder="New laptop" /></Field><Field label="Target (₦)"><input inputMode="decimal" value={gt} onChange={(e) => setGt(e.target.value)} /></Field><Field label="By"><input type="date" value={gd} onChange={(e) => setGd(e.target.value)} /></Field>
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => guard(() => { repo.addGoal(gn || 'Goal', toMinor(gt || '0'), gd || null); setGn(''); setGt(''); setGd(''); })}>Add goal</button></div></Section>

    <Section title="Repeating items">
      {rec.length === 0 ? <Empty title="Nothing repeats yet" body="Rent, salary, subscriptions: add them once and Tally will ask you before adding each one." /> : <div className="list">{rec.map((r) => <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}><span>{r.description} <span className="muted small">{r.frequency}, next {r.next_due}</span></span><span className="row"><Money v={r.amount} /><button className="btn quiet small" onClick={() => guard(() => repo.deleteRecurring(r.id))}>Stop</button></span></div>)}</div>}
      <div className="grid2" style={{ marginTop: 14 }}><Field label="What"><input value={rd} onChange={(e) => setRd(e.target.value)} placeholder="Rent" /></Field><Field label="Amount (₦)"><input inputMode="decimal" value={ra} onChange={(e) => setRa(e.target.value)} /></Field>
        <Field label="How often"><select value={rf} onChange={(e) => setRf(e.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="quarterly">Every three months</option><option value="yearly">Yearly</option></select></Field><Field label="Next due"><input type="date" value={rn} onChange={(e) => setRn(e.target.value)} /></Field></div>
      <div className="row"><button className={`btn small ${rk === 'out' ? '' : 'quiet'}`} onClick={() => setRk('out')}>Money out</button><button className={`btn small ${rk === 'in' ? '' : 'quiet'}`} onClick={() => setRk('in')}>Money in</button>
        <button className="btn" onClick={() => guard(() => { repo.addRecurring({ account_id: accts[0].id, description: rd, amount: (rk === 'out' ? -1 : 1) * Math.abs(toMinor(ra || '0')), category_id: null, frequency: rf, next_due: rn }); setRd(''); setRa(''); })}>Add repeating item</button></div></Section>

    {subs.length > 0 && <Section title="Subscriptions Tally spotted"><div className="list">{subs.map((s) => <div key={s.merchant} className="row" style={{ justifyContent: 'space-between' }}><span><strong style={{ textTransform: 'capitalize' }}>{s.merchant}</strong> <span className="muted small">{s.every}, seen {s.count} times, next around {s.next}</span></span><Money v={-s.amount} /></div>)}</div></Section>}
  </div>;
}
