# Tally — private, offline money notebook

A private personal-finance tracker. By default everything stays on your device (local database in the browser); optionally your transactions can be saved to a Neon Postgres database instead (see `docs/CLOUD.md`). Local features: on-device PDF/CSV/OFX/QIF import, automatic categorising, reconciliation against statement balances, budgets, goals, forecasts and a plain-language question bar. In the default mode there is no server, no account, no telemetry and no network calls. In cloud mode the only network traffic is to this site's own `/api/sync`.

**Runtime chosen: pure installable PWA** (sql.js WASM + IndexedDB + Web Workers). A Tauri/Electron shell was not built (see "Scope" below).

## Run it
```bash
npm install
npm run dev            # development (Vite dev server; strict CSP is applied to production builds only)
npm run build          # type-checks, then builds ./dist  (static files, open via any static server)
npm run preview        # serve ./dist locally
npm test               # 91 offline tests (+30 cloud tests when TEST_DATABASE_URL is set) (run also under TZ=America/New_York and Pacific/Auckland)
npm run coverage       # coverage for src/core
npm run audit:net      # after a build: verifies CSP + that only the sync client uses the network
npm run dev:api        # app + cloud API on :8787 (needs DATABASE_URL and TALLY_ACCESS_KEY)
npm run test:cloud     # 30 cloud tests against a THROWAWAY Postgres (TEST_DATABASE_URL)
npm run train          # retrain the baseline categoriser from data/seed-training.csv
```
Local mode: host `dist/` on any static host; after the first load it works with the network off (service worker caches the app shell). Cloud mode needs the Vercel deployment (it includes `/api`). Serve it with the CSP as an HTTP header too (see SECURITY_AUDIT.md).

## What is in the box
| Brief | Where |
|---|---|
| Local store, backups, restore, erase | `vault.ts`, `Safe.tsx`, `Welcome.tsx` |
| **Cloud storage (Neon)**: server API, row-level change tracking, sync controller, conflict screen | `api/`, `shared/sync-tables.js`, `src/core/sync/*`, `src/ui/CloudGate.tsx`, `docs/CLOUD.md` |
| Optional encryption code (AES-256-GCM + Argon2id) — present and tested, **not used by the app** | `crypto.ts`, `vault.ts` (`create`/`unlock`) |
| Transactions, splits, transfers, recurring, receipts | `repo.ts`, `Money.tsx`, `Plan.tsx` |
| Import CSV / OFX / QIF / PDF in a worker, review before saving | `src/core/import/*`, `src/workers/import.worker.ts`, `ImportView.tsx` |
| Categoriser: rules + Naive Bayes that learns from corrections; baseline model + training script | `categorize.ts`, `scripts/train-categorizer.ts`, `data/seed-training.csv`, `baseline-model.json` |
| Reconciliation, duplicate/outlier/gap detection, HTML audit report | `reconcile.ts`, `analytics.ts`, `Check.tsx` |
| Dashboard, insights, subscriptions, forecast, budgets, goals | `Today.tsx`, `analytics.ts`, `Plan.tsx` |
| Natural-language question bar (rule-based, no model) | `nlq.ts` |
| Design | `docs/DESIGN.md`, `src/ui/styles.css` |
| Quality gates | `DEBUG_LOG.md`, `SECURITY_AUDIT.md`, `tests/` |
| Docs | `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/USER_MANUAL.md` |

## Scope: what is and is not done
Done and tested: everything in the table above.

Deliberately different from the brief:
* **No passphrase and no encryption (your request).** The app opens straight to your data, stored as a plain SQLite file in this browser's IndexedDB. Anyone who can use this browser profile can read it. See SECURITY_AUDIT.md.
* **PWA, not Tauri/Electron.** A signed desktop installer cannot be produced or tested in the build environment. Consequences: no SQLCipher, no OS file permissions or scheduled folder backups (manual backups only).
* **Excel (.xlsx) import is not supported**; save as CSV. (The common npm package is unmaintained and has known advisories.)
* **No OCR.** Scanned/image-only PDFs are rejected with a clear message; use your bank's CSV export. Tesseract.js can be added behind the same worker.
* **No local LLM or voice input.** The question bar is a rule-based parser for common questions.

Not verified (needs you):
* **Neon and Vercel themselves.** Cloud mode was tested end to end against a local PostgreSQL 16 using the same `pg` driver and the same handler code, in a real browser. It has **not** been run on Vercel or against a Neon database (no access from the build environment). Expect to verify the first deploy; see docs/CLOUD.md.
* **Real bank PDFs.** Accuracy is 100% on synthetic statements only; the ≥ 95% criterion is unproven on real layouts.
* **Cross-browser.** Driven and screenshotted in headless Chromium only (no network requests, no console errors). Safari/Firefox and the service worker's offline mode are untested.
