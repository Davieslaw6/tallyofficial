# Debug log

Two passes, run in this order. Every entry: issue, reproduction, root cause, fix, test added.
Final state: **121 tests in 7 files (91 offline + 30 that need a Postgres)**, all passing under `TZ=Africa/Lagos`, `America/New_York` and `Pacific/Auckland`. No open P0/P1.

## What was and was not exercised
| Area | How it was exercised |
|---|---|
| DB layer, importers, reconciliation, budgets, splits, transfers, recurring, crypto, vault | Vitest unit/integration tests against real sql.js and real WebCrypto/Argon2id |
| PDF extraction | **Synthetic** statements generated with ReportLab (`tests/fixtures/make_pdfs.py`): two layouts, multi-page, wrapped narration |
| UI flows | One jsdom + Testing Library smoke test: onboarding, every screen, add transaction, NL bar, hotkey lock, wrong then right passphrase, data persisted through encrypted save |
| Real browser (Pass 3) | Headless Chromium driving the production build: setup, PDF import through the Web Worker, every screen, dark and 390px mobile, request and console logging |
| **Not exercised** | Safari/Firefox, service-worker offline mode, IndexedDB quotas, real bank PDFs, screen readers |

## Pass 1 — functional
| # | Sev | Issue | Reproduction | Root cause | Fix | Test |
|---|---|---|---|---|---|---|
| 1 | P1 | Corrupted vault file could not be recovered, although a good previous snapshot existed | Truncate the main vault blob to 60 bytes, unlock with the right passphrase → "Wrong passphrase" | AES-GCM cannot tell a truncated file from a wrong key, so my code treated both as "wrong passphrase" and refused to fall back | On failure, try the `.prev` snapshot **with the same passphrase**; a wrong passphrase still fails on both copies | `core.test.ts › recovers from a corrupted main file…`, `› profiles are isolated…` |
| 2 | P1 | Categorizer returned a confident category for text it had never seen | Teach one category six examples, then ask about `totally unknown thing` → `via: model` | Naive Bayes priors alone decided when only one class existed | Model is consulted only when the description shares at least one learned word; extracted `predictModel()` | `import.test.ts › learns from corrections…` |
| 3 | P2 | Field hints were read as part of the input's accessible name | Testing Library `getByLabelText('Passphrase')` failed; screen readers would announce the hint as the label | Hint `<small>` was inside the `<label>` | Hint moved outside the label | `ui.test.tsx` |
| 4 | P2 | Secure-wipe would throw on any vault over 64 KB | Found in code review before a test existed: `getRandomValues` is capped at 65,536 bytes per call | Single call over the whole buffer | Fill in 64 KB chunks | `core.test.ts › wipe removes the vault…` (small vault) plus review; **not** tested with a large blob |
| 5 | P3 | Type errors: `recurring_id` missing on `Tx`; Node types missing | `tsc --noEmit` | Omission | Added field and `@types/node` | typecheck is part of `npm run build` |
Test-authoring mistakes found while writing Pass 1 (not product bugs): a self-contradictory reconcile assertion was corrected.

Pass 1 exit: full suite green (52 tests at that point), typecheck clean.

## Pass 2 — adversarial
Scenarios: malformed PDFs, huge files, unicode, time zone/DST, negative and absurd amounts, duplicate imports, interrupted writes, low disk, corrupt DB. Full suite re-run afterwards.

| # | Sev | Issue | Reproduction | Root cause | Fix | Test |
|---|---|---|---|---|---|---|
| 6 | **P0** | **A failed save (disk full) silently lost the change.** The vault considered itself saved and never retried; the in-memory change would disappear on lock or reload | Make the store throw `QuotaExceededError` on one write, then keep working | `flush()` cleared `dirty` *before* writing; a rejected write also broke the promise chain so later saves were skipped | `dirty` is cleared only after a successful write and only if no newer change arrived (revision counter); chain recovers after a failure; background failures call `onSaveError` (toast) and retry after 5 s; `lock()` keeps the vault open if the final save fails | `adversarial.test.ts › a failed write (disk full) never loses…`, `› one failed write does not poison later saves` |
Pass 2 test-expectation corrections (not product bugs): after a fallback the previous snapshot legitimately lacks the latest row; `BOLT` vs `Bolt` is correctly an *exact* duplicate because merchants are normalised.

Scenarios that passed first time:
* 150 randomly byte-flipped or truncated PDFs: every one returned a result or a clean error; no hang, no crash.
* CSV: 210,000 rows rejected cleanly; 1 MB cell, NUL bytes, bidi and combining characters accepted; 50,000 rows parsed in under 5 s.
* OFX: entity declarations refused; a 200 KB amount tag parsed in under 2 s.
* Absurd amount (`99999999999999999999.00`) rejected at commit; transaction rolled back, no half-imported statement left.
* Hostile text (`<img onerror>`, `<script>`, SQL injection string) stored verbatim, escaped in the HTML report, never executed.
* Date arithmetic is calendar-based; verified across US and NZ DST changes.
* Forged archive headers (absurd Argon2 memory) rejected before key derivation.
* Passphrase change leaves no snapshot under the old passphrase.
* 50,000 transactions: report queries ≈ 75 ms; encrypted save ≈ 75 ms (8.1 MB); open + load ≈ 0.4 s.

Pass 2 exit: full suite green (68 tests) in three time zones.

## Pass 3 — real browser (after the redesign)
| # | Sev | Issue | Reproduction | Root cause | Fix | Verification |
|---|---|---|---|---|---|---|
| 7 | **P0** | **Every import (PDF, CSV, OFX, QIF) failed in a real browser** with a blank error; tests had passed | Upload any file on the Import screen in Chromium | PDF.js starts its own message handler inside the import worker and posts a `ready` message. My code treated the first worker message as the result, rejected with an empty error and terminated the worker. The Node/jsdom tests never run the worker | Worker replies are tagged `tally: true`; the main thread ignores all other messages | Headless Chromium: PDF parsed to 10 rows, statement check "Opening + rows = closing". **No automated test covers the worker path**; it was verified by the browser script only |
| 8 | P2 | Money table truncated dates and descriptions; mobile header wrapped to three rows; mobile table header misaligned | Screenshots at 1100px and 390px | Fixed-width columns too wide for the new 760px page; header rendered a Date column the narrow layout lacks | Narrower columns, account name moved under the description, scrollable single-row mobile nav, Date header hidden when narrow | Re-screenshotted |

## Pass 4 — user-reported: PDF import treated every row as money in
| # | Sev | Issue | Reproduction | Root cause | Fix | Test |
|---|---|---|---|---|---|---|
| 9 | **P0** | **PDF statements imported with every row as money in; no money out** | Four layouts generated in `tests/fixtures/make_pdfs.py`: single *Amount* column with no running balance; a *Type* column (Debit/Credit); headers `Debit (₦)` / `Credit (₦)`; headers `Withdrawals` / `Lodgements`. Before the fix each gave 0 money-out rows and opening + rows ≠ closing | (a) Column headers were matched exactly, so `Debit (₦)`, `Withdrawals`, `Lodgements` were not recognised. (b) With no column, DR/CR marker or running balance, the parser kept the printed (positive) amount and only attached a warning. (c) A *Type* cell was not read as a direction | Tolerant header matching (letters only; adds withdrawal, lodgement, money out/in…); Type column read as direction and removed from the narration; fallback chain: running balance → explicit minus/brackets/DR-CR/Type → narration clues → assume money out (flagged); then `solveDirections` uses the statement's opening and closing balances to confirm or correct guessed rows (applies only when the fix is unique); review screen gets **Flip** per row and **Flip every row**, and the statement check recalculates live; hashes recomputed after flips | `import.test.ts › PDF direction…` (4 layouts, explicit signs, solver, ambiguous/impossible cases, flip + commit). Verified in headless Chromium: 6 out / 2 in, statement check passes |
Why earlier tests missed it: my first synthetic PDFs all had separate Debit/Credit headers with exact wording or a running balance.

## Pass 5 — cloud storage (Neon)
Test method: 30 tests against a real PostgreSQL 16 through the same `pg` driver and handler code that Vercel runs (fake `fetch` wired to the handler for two simulated devices), then a live Chromium run with two browsers against the real API server.
| # | Sev | Issue | How found | Root cause | Fix |
|---|---|---|---|---|---|
| 10 | P1 | Pulled numbers came back as strings (`"-150000"`), which would corrupt amounts on a second device | Server round-trip test | Postgres returns `BIGINT` as text; the conversion lived only in the production pool module, not in the shared logic | Convert in `pull()` itself; covered by the round-trip test (incl. 9,007,199,254,740 and −999,999,999,999,999) |
| 11 | P1 | If the cloud tables disappeared while the server was running (e.g. cleared in the Neon console), every request failed with 500 until the function restarted | Live browser run (I dropped the schema between runs) | The "schema exists" check was cached per process | On Postgres "undefined table" the handler forgets the cache, recreates the schema and retries once (test: `if the tables are removed behind the server's back…`) |
| 12 | P3 | UI text said "Tally makes no network connections" and "never connects to the internet" while in cloud mode | Review of the cloud-mode screenshots | Copy written for local mode only | Wording depends on the mode |
Test-authoring mistakes (not product bugs): wrong sign in a SQL cross-check, an expected row count off by one in the conflict scenario, and reading an unconverted `BIGINT` in my own direct query.

Verified in a real browser (headless Chromium + real API + real Postgres): wrong key rejected with a clear message; linking uploaded 187 transactions, 2 accounts and 18 categories; a UI edit appeared in Postgres as `-432100` for ₦4,321.00; going offline queued the edit (nothing reached Postgres) and "Offline: 1 waiting" showed, then it uploaded on reconnect; a second browser with a separate profile downloaded everything and its dashboard total equalled the first device's (₦808,647 + ₦4,321 + ₦999 = ₦813,967); an edit on device 2 showed up on device 1 after reload; forcing both devices to edit produced "Cloud: needs attention", the cloud was **not** overwritten (0 rows from the stale device), the conflict screen listed both sides, and choosing "Keep the cloud version" kept device 2's edit and dropped device 1's. Requests went only to the app's own origin, every `/api/sync` call carried the key in the header (never in the URL), and there were no page errors. Closing a page with unsent edits triggered the browser's leave-page prompt.
Performance (local Postgres): 20,000 transactions upload in ≈ 1.3–1.8 s (8 requests); a fresh device downloads and rebuilds them in ≈ 0.45 s; recording changes for 50,000 inserts costs ≈ 3.6 s extra in a single transaction.

## Known gaps (honest list)
* PDF accuracy is **100% on my synthetic statements**. The "≥ 95% on typical bank PDFs" criterion is **unverified** against real Nigerian bank layouts; expect to add templates or fix heuristics once real files are tried. The importer shows a confidence per row and a "statement check" (opening + rows = closing) precisely so mistakes are visible.
* Interrupted *page close* during a save relies on IndexedDB's own atomic transaction; not simulated beyond the failure injection above.
* Keyboard-only flow, screen readers, Safari/Firefox and the service worker's offline behaviour are untested.
* The import worker has no automated test (see #7); a regression would only show in a browser.
* Cloud mode has not been run on Vercel or Neon themselves, only on a local PostgreSQL 16. Not covered: Neon cold starts and connection limits, Vercel function timeouts on very large first uploads, two devices pushing in the same millisecond across serverless instances (the row lock handles it in Postgres, tested with concurrent connections), and clock or DST effects (none: no timestamps are compared).
