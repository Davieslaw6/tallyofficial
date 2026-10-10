import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-ignore legacy build runs in Node
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseCsv, toCsv, parseCsvText } from '../src/core/import/csv';
import { parseOfx } from '../src/core/import/ofx';
import { parseQif } from '../src/core/import/qif';
import { parseAny, sniff, ImportError } from '../src/core/import';
import { prepareReview, commitReview, makeCategorizer, AlreadyImported } from '../src/core/ingest';
import { reconcile, auditReportHtml } from '../src/core/reconcile';
import { findDuplicates, findOutliers, detectSubscriptions, forecast, budgetStatus, insights, findGaps } from '../src/core/analytics';
import { ask } from '../src/core/nlq';
import { Categorizer } from '../src/core/categorize';
import { freshRepo } from './helpers';

const pdf = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));

describe('CSV', () => {
  it('maps debit/credit columns, handles quotes, BOM, semicolons', () => {
    const t = '\ufeffDate;Narration;Debit;Credit;Balance\n05/03/2026;"POS, SHOPRITE ""LEKKI""";1,500.00;;98,500.00\n06/03/2026;Salary;;50,000.00;148,500.00\n';
    const r = parseCsv(t); expect(r.rows).toHaveLength(2); expect(r.rows[0]).toMatchObject({ date: '2026-03-05', amount: -150000, description: 'POS, SHOPRITE "LEKKI"' }); expect(r.rows[1].amount).toBe(5000000);
  });
  it('reports skipped rows instead of silently dropping them', () => {
    const r = parseCsv('Date,Description,Amount\n2026-01-01,ok,10.00\nnot a date,bad,5.00\n2026-01-03,,5.00\n'); expect(r.rows).toHaveLength(1); expect(r.skipped).toHaveLength(2);
  });
  it('rejects files without usable columns, and empty files', () => { expect(() => parseCsv('a,b\n1,2')).toThrow(ImportError); expect(() => parseCsv('')).toThrow(ImportError); });
  it('survives multiline cells and CRLF', () => { expect(parseCsvText('a,"x\ny"\r\nb,c')).toEqual([['a', 'x\ny'], ['b', 'c']]); });
  it('export neutralises spreadsheet formulas', () => { expect(toCsv([['=HYPERLINK("http://evil")', '+1', 'ok']])).toContain("\"'=HYPERLINK"); expect(toCsv([['@x']])).toBe("'@x"); });
});
describe('OFX / QIF', () => {
  const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><DTSTART>20260301<DTEND>20260331\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305120000<TRNAMT>-1500.00<FITID>1<NAME>SHOPRITE<MEMO>POS &amp; more\n</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260306<TRNAMT>50000.00<FITID>2<NAME>SALARY\n</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>48500.00<DTASOF>20260331</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  it('parses SGML-style OFX incl. balance and entities', () => { const r = parseOfx(ofx); expect(r.rows).toHaveLength(2); expect(r.rows[0].description).toBe('SHOPRITE — POS & more'); expect(r.closingBalance).toBe(4850000); expect(r.periodEnd).toBe('2026-03-31'); });
  it('refuses XML entity declarations (XXE/billion laughs)', () => { expect(() => parseOfx('<!DOCTYPE x [<!ENTITY a "b">]><OFX></OFX>')).toThrow(/disallowed/); });
  it('parses QIF', () => { const r = parseQif('!Type:Bank\nD05/03/2026\nT-1,500.00\nPShoprite\nMPOS\n^\nD06/03/2026\nT50000.00\nPSalary\n^\n'); expect(r.rows).toHaveLength(2); expect(r.rows[0].amount).toBe(-150000); });
  it('sniffs types', () => { expect(sniff('x.bin', new TextEncoder().encode('%PDF-1.4'))).toBe('pdf'); expect(sniff('a.csv', new TextEncoder().encode('Date,x'))).toBe('csv'); expect(sniff('a', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx'); });
  it('excel gives actionable message', async () => { await expect(parseAny('a.xlsx', new Uint8Array([0x50, 0x4b, 3, 4]))).rejects.toThrow(/CSV/); });
});

describe('PDF statements (local extraction)', () => {
  it('multi-page, multi-column table with wrapped narration → every row, correct signs, balances reconcile', async () => {
    const r = await parseAny('stmt.pdf', pdf('stmt_columns.pdf'), pdfjs);
    expect(r.rows).toHaveLength(10); expect(r.openingBalance).toBe(50000000); expect(r.closingBalance).toBe(84899550); expect(r.periodStart).toBe('2026-03-01'); expect(r.periodEnd).toBe('2026-03-31');
    expect(r.rows[1].amount).toBe(45000000); expect(r.rows[0].amount).toBe(-1850000); expect(r.rows[3].amount).toBe(-320050);
    expect(r.rows[6].description).toContain('REF 0099887766'); // wrapped line joined
    expect(r.rows.every((x) => x.confidence >= 0.9)).toBe(true); expect(r.rows.every((x) => x.page && x.line)).toBe(true);
    const sum = r.rows.reduce((s, x) => s + x.amount, 0); expect(r.openingBalance! + sum).toBe(r.closingBalance); // 100% amount accuracy
  });
  it('single amount column with CR/DR markers + running balance', async () => {
    const r = await parseAny('s.pdf', pdf('stmt_crdr.pdf'), pdfjs); expect(r.rows.map((x) => x.amount)).toEqual([30000000, -1200000, -450000]); expect(r.openingBalance).toBe(10000000); expect(r.closingBalance).toBe(38350000);
  });
  it('rejects non-PDF, truncated and garbage input with clear errors', async () => {
    await expect(parseAny('x.pdf', new TextEncoder().encode('%PDF-1.4 garbage'), pdfjs)).rejects.toThrow(/damaged|unreadable|No/);
    const t = pdf('stmt_columns.pdf').slice(0, 900); await expect(parseAny('t.pdf', t, pdfjs)).rejects.toBeInstanceOf(Error);
  });
  it('enforces size limit', async () => { await expect(parseAny('big.csv', new Uint8Array(26 * 1024 * 1024))).rejects.toThrow(/limit/); });
});

describe('import → review → commit → reconcile', () => {
  it('end to end: dedupe, categorise, learn, reconcile to statement closing', async () => {
    const { repo, acct, db } = await freshRepo(); repo.db.run('UPDATE accounts SET opening_balance=? WHERE id=?', [50000000, acct]);
    const bytes = pdf('stmt_columns.pdf'); const parsed = await parseAny('s.pdf', bytes, pdfjs); const cat = makeCategorizer(repo);
    const review = prepareReview(repo, parsed, acct, cat);
    const name = (id: number | null) => repo.categories().find((c) => c.id === id)?.name;
    expect(name(review[0].categoryId)).toBe('Groceries'); expect(name(review[1].categoryId)).toBe('Salary'); expect(name(review[2].categoryId)).toBe('Airtime & data'); expect(name(review[3].categoryId)).toBe('Transport'); expect(name(review[4].categoryId)).toBe('Bank fees'); expect(name(review[5].categoryId)).toBe('Subscriptions');
    const corr = repo.categoryId('Gifts & giving')!; review[6].categoryId = corr; review[6].remember = true;
    const res = commitReview(repo, acct, review, cat, { fileBytes: bytes, format: 'pdf', parsed }); expect(res.added).toBe(10);
    expect(() => commitReview(repo, acct, review, cat, { fileBytes: bytes, format: 'pdf', parsed })).toThrow(AlreadyImported);
    // re-import of same rows from a different file is caught as exact duplicates
    const again = prepareReview(repo, parsed, acct, makeCategorizer(repo)); expect(again.every((r) => r.dup === 'exact' && !r.accept)).toBe(true);
    // learning: the remembered rule now applies on a fresh categorizer
    expect(makeCategorizer(repo).suggest('ATM WDL / FIRST BANK / VI BRANCH', -5000).categoryId).toBe(corr);
    const rec = reconcile(repo, acct, parsed); expect(rec.balanced).toBe(true); expect(rec.matched).toHaveLength(10); expect(rec.closingDelta).toBe(0);
    expect(auditReportHtml('GTBank', rec)).toContain('Balanced');
    expect(db.scalar('SELECT COUNT(*) FROM audit_log WHERE event=\'import\'')).toBe(1);
  });
  it('reconcile explains a missing transaction and a duplicate', async () => {
    const { repo, acct } = await freshRepo(); repo.db.run('UPDATE accounts SET opening_balance=100000 WHERE id=?', [acct]);
    const base = { account_id: acct, date: '2026-03-02' };
    repo.addTx({ ...base, amount: -20000, description: 'Shoprite' }); repo.addTx({ ...base, amount: -20000, description: 'Shoprite' });
    const st = { openingBalance: 100000, closingBalance: 60000, periodStart: '2026-03-01', periodEnd: '2026-03-31' };
    expect(reconcile(repo, acct, st).balanced).toBe(true); // two 200.00 debits: 1000 - 400 = 600
    const st2 = { ...st, closingBalance: 80000 }; const r2 = reconcile(repo, acct, st2); expect(r2.closingDelta).toBe(-20000); expect(r2.explanations.join(' ')).toMatch(/twice|wrong sign|differ/);
    expect(() => reconcile(repo, acct, { openingBalance: 1, closingBalance: 1, periodStart: '', periodEnd: '' } as never)).toThrow();
  });
  it('reconcile flags a statement-only transaction', async () => {
    const { repo, acct } = await freshRepo(); repo.addTx({ account_id: acct, date: '2026-03-02', amount: -1000, description: 'a' });
    const rows = [{ date: '2026-03-02', amount: -1000, description: 'a', confidence: 1 }, { date: '2026-03-04', amount: -500, description: 'SMS fee', confidence: 1 }];
    const r = reconcile(repo, acct, { openingBalance: 0, closingBalance: -1500, periodStart: '2026-03-01', periodEnd: '2026-03-31', rows }); expect(r.unmatchedStatement).toHaveLength(1); expect(r.explanations[0]).toMatch(/not in your books/);
  });
  it('same-day identical purchases within one file are both kept', async () => {
    const { repo, acct } = await freshRepo(); const parsed = parseCsv('Date,Description,Amount\n2026-03-01,Bolt ride,-1000\n2026-03-01,Bolt ride,-1000\n'); const cat = makeCategorizer(repo);
    const rv = prepareReview(repo, parsed, acct, cat); expect(rv[0].hash).not.toBe(rv[1].hash); expect(rv.every((r) => r.accept)).toBe(true); expect(commitReview(repo, acct, rv, cat, { fileBytes: new TextEncoder().encode('x'), format: 'csv', parsed }).added).toBe(2);
  });
});

describe('categoriser', () => {
  it('learns from corrections via Naive Bayes and respects sign', () => {
    const cats = [{ id: 1, name: 'Eating out', kind: 'expense' }, { id: 2, name: 'Salary', kind: 'income' }, { id: 3, name: 'Other', kind: 'expense' }, { id: 4, name: 'Other income', kind: 'income' }, { id: 5, name: 'Health', kind: 'expense' }];
    const c = new Categorizer(cats); for (let i = 0; i < 6; i++) c.learn('Mama Put Joint Yaba 00' + i, -1500, 1);
    expect(c.suggest('MAMA PUT JOINT YABA 777', -2000)).toMatchObject({ categoryId: 1, via: 'model' }); expect(c.suggest('totally unknown thing', -100).via).toBe('none');
    expect(c.suggest('SALARY PAYROLL', -100).categoryId).not.toBe(2); // a debit can't be salary
  });
});
describe('analytics', () => {
  it('detects duplicates, outliers, subscriptions, gaps', async () => {
    const { repo, acct } = await freshRepo(); const g = repo.categoryId('Groceries')!;
    for (const d of ['2025-11-05', '2025-12-05', '2026-01-05', '2026-02-05']) repo.addTx({ account_id: acct, date: d, amount: -450000, description: 'NETFLIX.COM', category_id: repo.categoryId('Subscriptions') });
    for (let i = 0; i < 12; i++) repo.addTx({ account_id: acct, date: `2026-02-${String(i + 1).padStart(2, '0')}`, amount: -(1000 + (i % 3) * 100) * 100, description: 'Shop ' + i, category_id: g });
    repo.addTx({ account_id: acct, date: '2026-02-20', amount: -90000000, description: 'Big shop', category_id: g });
    repo.addTx({ account_id: acct, date: '2026-02-21', amount: -5000, description: 'Pharmacy ONE', category_id: null }); repo.addTx({ account_id: acct, date: '2026-02-22', amount: -5000, description: 'Pharmacy ONE' });
    const all = repo.list();
    expect(findDuplicates(all).length).toBeGreaterThan(0); expect(findOutliers(all).some((f) => /Big shop/.test(f.message))).toBe(true);
    const subs = detectSubscriptions(all); expect(subs).toHaveLength(1); expect(subs[0]).toMatchObject({ merchant: expect.stringContaining('netflix'), every: 'monthly', amount: 450000, next: '2026-03-05' });
    expect(findGaps(all, 5, 5).length).toBeGreaterThan(0);
  });
  it('budget status, insights and forecast', async () => {
    const { repo, acct } = await freshRepo(); const g = repo.categoryId('Groceries')!; repo.setBudget(g, 1000000, 0.8);
    repo.addTx({ account_id: acct, date: '2026-03-02', amount: -900000, description: 'Shoprite', category_id: g });
    expect(budgetStatus(repo, '2026-03')[0].state).toBe('near'); repo.addTx({ account_id: acct, date: '2026-03-03', amount: -200000, description: 'Shoprite', category_id: g });
    expect(budgetStatus(repo, '2026-03')[0].state).toBe('over'); expect(insights(repo, '2026-03').some((i) => /over budget/.test(i.title))).toBe(true);
    repo.addRecurring({ account_id: acct, description: 'Rent', amount: -50000000, category_id: null, frequency: 'monthly', next_due: '2026-04-01' });
    const f = forecast(repo, '2026-03-10', 60); expect(f).toHaveLength(61); expect(f[60].balance).toBeLessThan(f[0].balance - 50000000 + 1);
  });
  it('natural-language questions run on-device', async () => {
    const { repo, acct } = await freshRepo(); const g = repo.categoryId('Groceries')!;
    repo.addTx({ account_id: acct, date: '2026-02-10', amount: -1250000, description: 'Shoprite Lekki', category_id: g }); repo.addTx({ account_id: acct, date: '2026-02-11', amount: 50000000, description: 'Salary', category_id: repo.categoryId('Salary') });
    const t = '2026-03-15';
    expect(ask(repo, 'How much did I spend on groceries last month?', t).text).toMatch(/12,500\.00 on groceries in last month/);
    expect(ask(repo, 'income in february', t).text).toMatch(/500,000\.00/); expect(ask(repo, 'what is my balance', t).text).toMatch(/total balance/);
    expect(ask(repo, 'how much did I spend at shoprite in february', t).text).toMatch(/12,500\.00/); expect(ask(repo, 'top categories last month', t).rows?.[0].label).toBe('Groceries');
    expect(ask(repo, 'blah blah', t).understood).toBe(false);
  });
});
