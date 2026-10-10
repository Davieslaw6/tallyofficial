# Architecture

```
┌────────────────────────── browser tab (CSP: connect-src 'none') ──────────────────────────┐
│ React UI (src/ui)                                                                          │
│   Gate → unlock/create        App shell (rail, ask bar, palette, auto-lock)                │
│   Today · Money · Import · Check · Plan · Safe                                             │
│        │ useApp(): repo, categoriser, session                                              │
│ Core (src/core, no DOM, fully unit-tested)                                                 │
│   Repo ── Db (sql.js, in memory) ── Session ──► seal (AES-256-GCM) ──► IndexedDB blob      │
│   importers · ingest · reconcile · analytics · nlq · categorize · audit                    │
│        ▲ parsed rows (structured clone)                                                    │
│ Import Web Worker: PDF.js (bundled) + CSV/OFX/QIF parsers; network APIs disabled; killable │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key decisions
* **One encrypted file per profile.** Each profile is a separate SQLite database sealed with its own Argon2id-derived key and salt. Profile isolation is cryptographic, not a `WHERE` clause. (`profile_id` columns exist for the spec's indexes and future merging.)
* **Whole-file encryption.** The SQLite database lives in memory while unlocked and is exported, sealed and written (debounced, 400 ms) to IndexedDB. The previous good copy is kept as `.prev`; a write failure leaves changes queued and retries.
* **Money is integer kobo**; dates are plain ISO strings, so DST and time zones cannot move a transaction.
* **Transfers** are two linked rows (`transfer_group`) excluded from income/expense. **Splits** must sum exactly to the parent; reports count splits by their own categories.
* **Import pipeline:** worker parse → `prepareReview` (categorise, hash, duplicate check) → user review → `commitReview` (single DB transaction; statement recorded by file hash; corrections teach the model and remembered merchants become rules).
* **Duplicates:** exact = same account/date/amount/normalised merchant/occurrence (unique index); possible = same amount within 3 days with similar text.
* **Categoriser order:** user rules → built-in keyword rules (sign-checked) → Naive Bayes (only when it shares learned words) → "Other".
* **Audit log:** hash-chained, triggers block UPDATE/DELETE.
* **PDF extraction:** PDF.js text items → lines (y-tolerance) → cells (x-gaps) → header-anchored columns, running-balance sign checks, CR/DR markers, wrapped-narration joining, opening/closing balance detection. Every row carries confidence and page/line provenance.

## Folder structure
```
src/core/        money, dates, crypto, vault, db, schema, repo, categorize, ingest, reconcile, analytics, nlq, audit, sha256, sample
src/core/import/ csv, ofx, qif, pdf, index (sniffing), types (limits)
src/workers/     import.worker.ts
src/ui/          App, Gate, Today, Money, ImportView, Check, Plan, Safe, ui (primitives), store, boot, parse, styles.css
tests/           core, import, adversarial, ui, fixtures/ (synthetic PDFs + generator)
scripts/         train-categorizer.ts, verify-no-network.mjs, contrast.mjs
public/          sw.js, manifest, icon
docs/            DESIGN, ARCHITECTURE, SCHEMA, USER_MANUAL
```
