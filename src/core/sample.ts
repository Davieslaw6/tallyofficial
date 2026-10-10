import type { Repo } from './repo';
import { addDays, addMonths, monthKey } from './dates';

/** Synthetic demo data (clearly labelled "Sample" in the UI). Deterministic so screenshots and tests are stable. */
export function loadSample(repo: Repo, today: string): number {
  let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const cur = repo.addAccount('Sample · Current', 'checking', 25_000_000, addMonths(today.slice(0, 7) + '-01', -6));
  const sav = repo.addAccount('Sample · Savings', 'savings', 40_000_000);
  const C = (n: string) => repo.categoryId(n);
  const merchants: [string, string, number, number][] = [
    ['Groceries', 'SHOPRITE LEKKI', 1500000, 5500000], ['Groceries', 'SPAR AJAH', 800000, 3000000], ['Eating out', 'CHICKEN REPUBLIC', 350000, 1200000], ['Eating out', 'KILIMANJARO', 300000, 900000],
    ['Transport', 'BOLT RIDE', 150000, 600000], ['Transport', 'UBER TRIP', 200000, 800000], ['Fuel', 'TOTAL ENERGIES FILLING STATION', 1000000, 3000000], ['Airtime & data', 'MTN DATA BUNDLE', 100000, 500000],
    ['Shopping', 'JUMIA ORDER', 500000, 4500000], ['Health', 'MEDPLUS PHARMACY', 200000, 1500000], ['Bank fees', 'SMS ALERT CHARGE', 400, 1000],
  ];
  const first = addMonths(today.slice(0, 7) + '-01', -5);
  for (let m = 0; m < 6; m++) {
    const base = addMonths(first, m);
    repo.addTx({ account_id: cur, date: addDays(base, 24), amount: 52_000_000, description: 'SALARY ACME LTD', category_id: C('Salary'), source: 'sample' });
    repo.addTx({ account_id: cur, date: addDays(base, 0), amount: -15_000_000, description: 'RENT LANDLORD TRF', category_id: C('Rent'), source: 'sample' });
    repo.addTx({ account_id: cur, date: addDays(base, 4), amount: -450000, description: 'NETFLIX.COM', category_id: C('Subscriptions'), source: 'sample' });
    repo.addTx({ account_id: cur, date: addDays(base, 9), amount: -1050000, description: 'DSTV SUBSCRIPTION', category_id: C('Subscriptions'), source: 'sample' });
    repo.addTx({ account_id: cur, date: addDays(base, 14), amount: -1800000, description: 'IKEDC PREPAID METER', category_id: C('Utilities'), source: 'sample' });
    const n = 22 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) { const [cat, name, lo, hi] = merchants[Math.floor(rnd() * merchants.length)]; const amt = -Math.round((lo + rnd() * (hi - lo)) / 100) * 100; repo.addTx({ account_id: cur, date: addDays(base, Math.floor(rnd() * 27)), amount: amt, description: name, category_id: C(cat), source: 'sample' }); }
    if (monthKey(base) <= monthKey(today)) repo.addTransfer(cur, sav, 5_000_000, addDays(base, 25), 'monthly saving');
  }
  repo.addTx({ account_id: cur, date: addDays(today, -9), amount: -38_500_000, description: 'JUMIA LAPTOP ORDER', category_id: C('Shopping'), source: 'sample' });
  for (const [n, b] of [['Groceries', 8_000_000], ['Eating out', 2_500_000], ['Transport', 2_000_000], ['Shopping', 3_000_000]] as const) repo.setBudget(C(n)!, b);
  repo.addGoal('Emergency fund', 150_000_000, addMonths(today, 10), 40_000_000);
  repo.addRecurring({ account_id: cur, description: 'RENT LANDLORD TRF', amount: -15_000_000, category_id: C('Rent'), frequency: 'monthly', next_due: addMonths(first, 6) });
  return cur;
}
