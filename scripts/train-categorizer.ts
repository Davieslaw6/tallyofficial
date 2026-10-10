/** Trains the baseline Naive Bayes categorizer from data/seed-training.csv and writes src/core/baseline-model.json.
 *  Run: npm run train.  Seed data is SYNTHETIC (invented, Nigeria-flavoured descriptions) — no real transactions. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Categorizer, emptyModel } from '../src/core/categorize';
import { DEFAULT_CATEGORIES } from '../src/core/schema';

const cats = DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, name: c.name, kind: c.kind }));
const id = (n: string) => cats.find((c) => c.name === n)!.id;
const lines = readFileSync('data/seed-training.csv', 'utf8').trim().split('\n').slice(1).map((l) => { const [cat, sign, desc] = l.split('|'); return { cat: id(cat), amt: sign === '+' ? 1 : -1, desc }; });
// deterministic 80/20 split
const train = lines.filter((_, i) => i % 5 !== 0), test = lines.filter((_, i) => i % 5 === 0);
const fit = (rows: typeof lines) => { const c = new Categorizer(cats, [], emptyModel()); rows.forEach((r) => c.learn(r.desc, r.amt, r.cat)); return c; };
const held = fit(train); let mHit = 0, mAns = 0, all = 0;
for (const t of test) { const p = held.predictModel(t.desc, t.amt, 0); if (p) { mAns++; if (p.categoryId === t.cat) mHit++; } if (held.suggest(t.desc, t.amt).categoryId === t.cat) all++; }
const final = fit(lines); writeFileSync('src/core/baseline-model.json', JSON.stringify(final.model));
console.log(`train=${train.length} held-out=${test.length}`);
console.log(`Naive Bayes ALONE (rules bypassed): answered ${mAns}/${test.length}, accuracy ${((mHit / test.length) * 100).toFixed(1)}% of all held-out`);
console.log(`Rules + model end to end: ${((all / test.length) * 100).toFixed(1)}%  (inflated: seed data was written from the same merchant names the rules know)`);
console.log(`baseline written: ${final.model.total} examples, ${final.model.vocab.length} words`);
