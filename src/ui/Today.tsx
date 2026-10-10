import { useMemo } from 'react';
import { useApp } from './store';
import { Money, DyeBar, Section, Empty } from './ui';
import { formatMoney, compactMoney } from '../core/money';
import { monthRange, shiftMonth } from '../core/dates';
import { budgetStatus, insights, forecast } from '../core/analytics';

const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (k: string) => `${MN[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;

export function Today({ play }: { play: boolean }) {
  const { repo, month, setMonth, v, today, go, setFilterCat, openAdd } = useApp();
  const d = useMemo(() => {
    const [a, b] = monthRange(month); const prev = shiftMonth(month, -1); const [pa, pb] = monthRange(prev);
    const cats = repo.byCategory(a, b); const ie = repo.incomeExpense(a, b); const pie = repo.incomeExpense(pa, pb);
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)); const series = repo.monthlySeries(months);
    const accts = repo.accounts().map((x) => ({ ...x, bal: repo.balance(x.id) }));
    const lastStatement = repo.db.one<{ account_id: number; period_end: string; closing_balance: number }>('SELECT account_id, period_end, closing_balance FROM statements WHERE period_end IS NOT NULL ORDER BY period_end DESC LIMIT 1');
    const unreviewed = repo.db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE category_id IS NULL AND transfer_group IS NULL') ?? 0;
    return { cats, ie, pie, prev, series, accts, lastStatement, unreviewed, ins: insights(repo, month).slice(0, 4), bud: budgetStatus(repo, month).slice(0, 4), fc: forecast(repo, today, 60) };
  }, [repo, month, v, today]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const total = d.accts.reduce((s, a) => s + a.bal, 0);
  const diff = d.ie.expense - d.pie.expense;
  if (!d.accts.length) return <Empty title="No accounts yet" body="Add an account in Safe, then import a statement or add a transaction." />;
  const empty = d.ie.expense === 0 && d.ie.income === 0;
  const max = Math.max(1, ...d.series.map((s) => Math.max(s.income, s.expense)));
  const low = d.fc.reduce((m, p) => (p.balance < m.balance ? p : m), d.fc[0]);

  return <div className="sheet">
    <div className="row" style={{ marginTop: 6 }}><button className="btn quiet small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">Earlier</button><strong style={{ fontFamily: 'var(--display)' }}>{monthName(month)}</strong><button className="btn quiet small" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">Later</button></div>
    {empty ? <><h1 className="headline">Nothing recorded for {monthName(month).split(' ')[0]} yet.</h1><p className="muted">Import a bank statement or add what you spent by hand.</p><div className="row"><button className="btn" onClick={() => go('import')}>Import a statement</button><button className="btn quiet" onClick={openAdd}>Add a transaction</button></div></>
      : <h1 className="headline">You spent <span className="amt">{formatMoney(d.ie.expense, { symbol: true })}</span> in {monthName(month).split(' ')[0]}{d.pie.expense > 0 && diff !== 0 ? <> — <span className="amt" style={{ color: diff < 0 ? 'var(--leaf)' : 'var(--zobo)' }}>{formatMoney(Math.abs(diff))}</span> {diff < 0 ? 'less' : 'more'} than {monthName(d.prev).split(' ')[0]}.</> : '.'}</h1>}
    {!empty && <><DyeBar play={play} parts={d.cats.map((c) => ({ id: c.category_id, name: c.name, value: c.total, color: c.color }))} onPick={(id) => { setFilterCat(id); go('money'); }} /></>}
    <div className="proof">
      <div><div className="l">Money you have</div><div className="v"><Money v={total} plain /></div></div>
      <div><div className="l">Came in</div><div className="v"><Money v={d.ie.income} plain /></div></div>
      <div><div className="l">Kept this month</div><div className="v"><Money v={d.ie.net} /></div></div>
      <div><div className="l">Last matched to a statement</div><div className="v" style={{ fontSize: 17 }}>{d.lastStatement ? <span className="ok">{d.lastStatement.period_end}</span> : <button className="btn quiet small" onClick={() => go('import')}>Not yet — import one</button>}</div></div>
    </div>
    {d.unreviewed > 0 && <p style={{ marginTop: 18 }}><span className="chip review">{d.unreviewed} need a category</span> <button className="btn quiet small" onClick={() => go('money')}>Review them</button></p>}

    {d.ins.length > 0 && <Section title="Worth a look">
      <div className="list">{d.ins.map((i) => <div key={i.id}><strong>{i.title}</strong><div className="muted small">{i.body}</div></div>)}</div></Section>}

    <Section title="Six months">
      <div className="bars" role="img" aria-label={d.series.map((s) => `${monthName(s.month)}: in ${formatMoney(s.income)}, out ${formatMoney(s.expense)}`).join('; ')} style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 30 }}>
        {d.series.map((s) => <div className="col" key={s.month}><i style={{ height: `${(s.income / max) * 100}%`, background: 'var(--leaf)' }} /><i style={{ height: `${(s.expense / max) * 100}%`, background: 'var(--zobo)' }} /><span className="lab">{MN[Number(s.month.slice(5)) - 1].slice(0, 3)}</span></div>)}
      </div>
      <p className="small muted"><span style={{ color: 'var(--leaf)' }}>■</span> money in <span style={{ color: 'var(--zobo)', marginLeft: 12 }}>■</span> money out. Transfers between your own accounts are left out.</p></Section>

    {d.bud.length > 0 && <Section title="Budgets" actions={<button className="btn quiet small" onClick={() => go('plan')}>All budgets</button>}>
      <div className="list">{d.bud.map((b) => <div key={b.categoryId}><div className="row" style={{ justifyContent: 'space-between' }}><strong>{b.name}</strong><span className="small"><Money v={-b.spent} plain /> of <Money v={b.limit} plain /></span></div><div className={`meter ${b.state}`} role="progressbar" aria-valuenow={Math.round(b.ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.name} budget`}><i style={{ width: `${Math.min(100, b.ratio * 100)}%` }} /></div></div>)}</div></Section>}

    <Section title="Accounts">
      <div className="list">{d.accts.map((a) => <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}><span>{a.name} <span className="muted small">{a.kind}</span></span><Money v={a.bal} plain /></div>)}</div></Section>

    {d.fc.length > 1 && <Section title="Next 60 days"><p>{low.balance < 0 ? <>Your balance could dip below zero around <strong>{low.date}</strong> ({compactMoney(low.balance)}) if spending continues at its recent pace.</> : <>At your recent pace you would have about <strong><Money v={d.fc[d.fc.length - 1].balance} plain /></strong> in 60 days.</>}</p>
      <Spark pts={d.fc.map((p) => p.balance)} /><p className="small muted">Based on your recurring items and the last 90 days of other spending.</p></Section>}
  </div>;
}

function Spark({ pts }: { pts: number[] }) {
  const w = 600, h = 80, mn = Math.min(...pts, 0), mx = Math.max(...pts, 1), sx = w / (pts.length - 1), y = (v: number) => h - ((v - mn) / (mx - mn || 1)) * (h - 8) - 4;
  const dpath = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * sx).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="80" preserveAspectRatio="none" role="img" aria-label="Projected balance"><line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="4 4" /><path d={dpath} fill="none" stroke="var(--dye)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg>;
}
