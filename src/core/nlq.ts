import type { Repo } from './repo';
import { formatMoney } from './money';
import { monthRange, shiftMonth, monthKey, isoDate, addDays } from './dates';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export interface Answer { text: string; rows?: { label: string; value: number }[]; understood: boolean }
interface Period { from: string; to: string; label: string }

export function parsePeriod(q: string, today: string): Period {
  const t = q.toLowerCase(); const cm = monthKey(today); const y = Number(today.slice(0, 4));
  let m: RegExpExecArray | null;
  if (/last month/.test(t)) { const k = shiftMonth(cm, -1); return { from: monthRange(k)[0], to: monthRange(k)[1], label: 'last month' }; }
  if (/this month/.test(t)) return { from: monthRange(cm)[0], to: today, label: 'this month' };
  if (/last year/.test(t)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
  if (/this year|year to date|ytd/.test(t)) return { from: `${y}-01-01`, to: today, label: 'this year' };
  if ((m = /last (\d{1,3}) days/.exec(t))) return { from: addDays(today, -Number(m[1])), to: today, label: `the last ${m[1]} days` };
  if (/last week/.test(t)) return { from: addDays(today, -7), to: today, label: 'the last 7 days' };
  if (/today/.test(t)) return { from: today, to: today, label: 'today' };
  for (let i = 0; i < 12; i++) { const re = new RegExp(`\\b${MONTHS[i]}\\b(?:\\s+(20\\d{2}))?|\\b${MONTHS[i].slice(0, 3)}\\b(?:\\s+(20\\d{2}))`); if ((m = re.exec(t))) { const yy = Number(m[1] ?? m[2] ?? (i + 1 > Number(today.slice(5, 7)) ? y - 1 : y)); const k = `${yy}-${String(i + 1).padStart(2, '0')}`; return { from: monthRange(k)[0], to: monthRange(k)[1], label: `${MONTHS[i][0].toUpperCase()}${MONTHS[i].slice(1)} ${yy}` }; } }
  if ((m = /\b(20\d{2})\b/.exec(t))) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31`, label: m[1] };
  return { from: monthRange(cm)[0], to: today, label: 'this month' };
}

const SYN: Record<string, string> = { food: 'Groceries', groceries: 'Groceries', grocery: 'Groceries', restaurants: 'Eating out', restaurant: 'Eating out', 'eating out': 'Eating out', transport: 'Transport', fuel: 'Fuel', petrol: 'Fuel', rent: 'Rent', airtime: 'Airtime & data', data: 'Airtime & data', subscriptions: 'Subscriptions', electricity: 'Utilities', utilities: 'Utilities', health: 'Health', school: 'Education', fees: 'Bank fees', 'bank fees': 'Bank fees', shopping: 'Shopping', entertainment: 'Entertainment', salary: 'Salary' };

export function ask(repo: Repo, question: string, today: string): Answer {
  const q = question.trim().toLowerCase().replace(/[?!.]+$/, ''); if (!q) return { text: 'Ask something like "How much did I spend on groceries last month?"', understood: false };
  const p = parsePeriod(q, today); const cats = repo.categories();
  const cat = cats.find((c) => q.includes(c.name.toLowerCase())) ?? cats.find((c) => Object.entries(SYN).some(([k, v]) => new RegExp(`\\b${k}\\b`).test(q) && v === c.name));
  const merchant = /\b(?:at|to|from|on)\s+([a-z0-9][a-z0-9 &'-]{2,30})$/.exec(q.replace(/\s+(last|this|in|during|for)\s.*$/, ''))?.[1]?.trim();

  if (/\b(balance|how much (?:money )?do i have|worth)\b/.test(q)) { const a = repo.accounts(); const tot = a.reduce((s, x) => s + repo.balance(x.id), 0); return { text: `Your total balance is ${formatMoney(tot)}.`, rows: a.map((x) => ({ label: x.name, value: repo.balance(x.id) })), understood: true }; }
  if (/\b(top|biggest|largest|most)\b.*\b(categor|spend)/.test(q) || /where.*(money|spend).*go/.test(q)) { const r = repo.byCategory(p.from, p.to).slice(0, 5); return r.length ? { text: `Your top spending in ${p.label}: ${r.map((x) => `${x.name} ${formatMoney(x.total)}`).join(', ')}.`, rows: r.map((x) => ({ label: x.name, value: x.total })), understood: true } : { text: `No spending found for ${p.label}.`, understood: true }; }
  if (/\b(biggest|largest|highest)\b.*\b(expense|purchase|transaction|payment)/.test(q)) { const t = repo.list({ from: p.from, to: p.to }).filter((x) => x.amount < 0 && !x.transfer_group).sort((a, b) => a.amount - b.amount)[0]; return t ? { text: `Your biggest expense in ${p.label} was "${t.description}" on ${t.date}: ${formatMoney(-t.amount)}.`, understood: true } : { text: `No expenses in ${p.label}.`, understood: true }; }
  if (/\b(how many|number of|count)\b.*transaction/.test(q)) { const n = repo.list({ from: p.from, to: p.to }).length; return { text: `${n} transaction${n === 1 ? '' : 's'} in ${p.label}.`, understood: true }; }
  if (/\b(income|earn|earned|made|salary|received)\b/.test(q) && !cat?.kind?.startsWith('exp')) { const ie = repo.incomeExpense(p.from, p.to); return { text: `Income in ${p.label}: ${formatMoney(ie.income)}.`, understood: true }; }
  if (/\b(save|saved|savings|net|left over|surplus)\b/.test(q)) { const ie = repo.incomeExpense(p.from, p.to); return { text: `In ${p.label} you earned ${formatMoney(ie.income)}, spent ${formatMoney(ie.expense)}, and kept ${formatMoney(ie.net)}.`, understood: true }; }
  if (/\b(spend|spent|spending|cost|paid|pay)\b/.test(q)) {
    if (cat) { const r = repo.byCategory(p.from, p.to).find((x) => x.category_id === cat.id); return { text: `You spent ${formatMoney(r?.total ?? 0)} on ${cat.name.toLowerCase()} in ${p.label}.`, understood: true }; }
    if (merchant) { const l = `%${merchant.replace(/[\\%_]/g, '\\$&')}%`; const s = repo.db.scalar<number>("SELECT COALESCE(SUM(-amount),0) FROM transactions WHERE amount<0 AND transfer_group IS NULL AND date BETWEEN ? AND ? AND description LIKE ? ESCAPE '\\'", [p.from, p.to, l]) ?? 0; return { text: `You spent ${formatMoney(s)} at "${merchant}" in ${p.label}.`, understood: true }; }
    const ie = repo.incomeExpense(p.from, p.to); return { text: `You spent ${formatMoney(ie.expense)} in ${p.label}.`, understood: true };
  }
  void isoDate;
  return { text: 'I didn\'t catch that. Try: "spent on groceries last month", "income this year", "top categories in March", or "what is my balance".', understood: false };
}
