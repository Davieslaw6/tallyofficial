/** On-device categorizer: user rules → built-in keyword rules → Naive Bayes trained on the user's own corrections. No network, no model download. */
export interface CatRef { id: number; name: string; kind: string }
export interface Suggestion { categoryId: number | null; confidence: number; via: 'user-rule' | 'keyword' | 'model' | 'none' }

const KEYWORDS: [string, string[]][] = [
  ['Salary', ['salary', 'payroll', 'wages']],
  ['Groceries', ['shoprite', 'spar', 'justrite', 'market square', 'ebeano', 'supermarket', 'grocer', 'foodco', 'prince ebeano', 'mile 12']],
  ['Eating out', ['chicken republic', 'kfc', 'dominos', 'domino', 'mr biggs', 'sweet sensation', 'restaurant', 'cafe', 'kilimanjaro', 'cold stone', 'bukka', 'eatery', 'glovo', 'chowdeck', 'foodcourt', 'pizza']],
  ['Transport', ['uber', 'bolt', 'indriver', 'lagride', 'brt', 'danfo', 'taxi', 'airline', 'air peace', 'arik', 'transport', 'waybill']],
  ['Fuel', ['total energies', 'oando', 'mobil', 'conoil', 'mrs fuel', 'filling station', 'petrol', 'fuel']],
  ['Rent', ['rent', 'landlord', 'lease']],
  ['Utilities', ['ikedc', 'ekedc', 'phed', 'aedc', 'nepa', 'prepaid meter', 'electricity', 'water bill', 'lawma', 'waste']],
  ['Airtime & data', ['airtime', 'mtn', 'airtel', 'glo ', 'globacom', '9mobile', 'etisalat', 'data bundle', 'vtu', 'spectranet', 'smile']],
  ['Subscriptions', ['netflix', 'spotify', 'dstv', 'gotv', 'showmax', 'youtube premium', 'apple.com/bill', 'icloud', 'google one', 'canva', 'subscription', 'startimes', 'amazon prime']],
  ['Health', ['pharmacy', 'hospital', 'clinic', 'medplus', 'healthplus', 'laboratory', 'diagnostic', 'hmo']],
  ['Education', ['school fees', 'tuition', 'university', 'waec', 'jamb', 'udemy', 'coursera', 'bookshop']],
  ['Shopping', ['jumia', 'konga', 'aliexpress', 'amazon', 'temu', 'shein', 'mall', 'boutique']],
  ['Entertainment', ['cinema', 'filmhouse', 'genesis', 'ticketmaster', 'eventbrite', 'betking', 'sporty', 'bet9ja', 'nairabet']],
  ['Bank fees', ['sms alert', 'sms charge', 'stamp duty', 'vat ', 'maintenance fee', 'card maintenance', 'commission', 'cot ', 'transfer fee', 'service charge', 'atm fee', 'nip fee', 'electronic money transfer levy', 'emtl']],
  ['Gifts & giving', ['church', 'tithe', 'offering', 'donation', 'zakat', 'gift', 'mosque', 'charity']],
  ['Other income', ['interest paid', 'dividend', 'refund', 'cashback', 'reversal', 'credit interest']],
];

export function normalizeMerchant(desc: string): string {
  return desc.toLowerCase()
    .replace(/\b(pos|web|nip|ussd|trf|transfer|payment|purchase|debit|credit|card|txn|ref|from|to|via|ng|lagos|lag|abuja|ltd|limited|plc|nigeria)\b/g, ' ')
    .replace(/[0-9]+/g, ' ').replace(/[^\p{L}\s&]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = (s: string) => normalizeMerchant(s).split(' ').filter((t) => t.length > 2);

export interface ModelState { docs: Record<string, number>; tok: Record<string, Record<string, number>>; vocab: string[]; total: number }
export const emptyModel = (): ModelState => ({ docs: {}, tok: {}, vocab: [], total: 0 });

export class Categorizer {
  private vocab: Set<string>;
  constructor(private cats: CatRef[], private rules: { pattern: string; category_id: number }[] = [], public model: ModelState = emptyModel()) { this.vocab = new Set(model.vocab); }
  private id(name: string) { return this.cats.find((c) => c.name === name)?.id ?? null; }
  private feats(desc: string, amount: number) { return [...tokens(desc), amount >= 0 ? '__in' : '__out']; }

  suggest(desc: string, amount: number): Suggestion {
    const norm = normalizeMerchant(desc), low = desc.toLowerCase();
    for (const r of this.rules) if (norm.includes(r.pattern) || low.includes(r.pattern)) return { categoryId: r.category_id, confidence: 0.98, via: 'user-rule' };
    for (const [cat, words] of KEYWORDS) {
      if (words.some((w) => low.includes(w))) {
        const id = this.id(cat);
        // sign sanity: a debit can't be "Salary"; a credit can't be a spending category except refunds
        if (id !== null && ((amount >= 0) === (this.cats.find((c) => c.id === id)!.kind === 'income'))) return { categoryId: id, confidence: 0.9, via: 'keyword' };
      }
    }
    const mp = this.predictModel(desc, amount); if (mp) return mp;
    return { categoryId: this.id(amount >= 0 ? 'Other income' : 'Other'), confidence: 0.2, via: 'none' };
  }

  /** Naive Bayes only (no rules). Returns null when the text shares no learned words or confidence is low. */
  predictModel(desc: string, amount: number, minConf = 0.55): Suggestion | null {
    const m = this.model; const f0 = this.feats(desc, amount).filter((t) => !t.startsWith('__'));
    // Only trust the model when the text shares at least one learned word — priors alone must never decide a category.
    if (m.total < 5 || !f0.some((t) => this.vocab.has(t))) return null;
    const f = this.feats(desc, amount); const classes = Object.keys(m.docs); const V = Math.max(1, this.vocab.size);
    const logp = classes.map((c) => { const n = Object.values(m.tok[c] ?? {}).reduce((a, b) => a + b, 0); return f.reduce((s, t) => s + Math.log(((m.tok[c]?.[t] ?? 0) + 1) / (n + V)), Math.log(m.docs[c] / m.total)); });
    const mx = Math.max(...logp); const ex = logp.map((l) => Math.exp(l - mx)); const z = ex.reduce((a, b) => a + b, 0); const i = ex.indexOf(Math.max(...ex)); const conf = ex[i] / z;
    return conf >= minConf ? { categoryId: Number(classes[i]), confidence: Math.min(0.89, conf), via: 'model' } : null;
  }

  /** Learn from a user correction. Returns the merchant pattern to persist as a rule when `remember` is set. */
  learn(desc: string, amount: number, categoryId: number, remember = false): string | null {
    const m = this.model; const k = String(categoryId);
    m.docs[k] = (m.docs[k] ?? 0) + 1; m.total++; m.tok[k] ??= {};
    for (const t of this.feats(desc, amount)) { m.tok[k][t] = (m.tok[k][t] ?? 0) + 1; this.vocab.add(t); }
    m.vocab = [...this.vocab];
    if (!remember) return null;
    const pat = normalizeMerchant(desc).split(' ').slice(0, 3).join(' ');
    if (pat.length < 3) return null;
    this.rules = [{ pattern: pat, category_id: categoryId }, ...this.rules.filter((r) => r.pattern !== pat)];
    return pat;
  }
}
