# Debug log

Two passes, run in this order. Every entry: issue, reproduction, root cause, fix, test added.
Final state: **68 tests, 4 files, all passing** under `TZ=Africa/Lagos`, `America/New_York` and `Pacific/Auckland`. No open P0/P1.

## What was and was not exercised
| Area | How it was exercised |
|---|---|
| DB layer, importers, reconciliation, budgets, splits, transfers, recurring, crypto, vault | Vitest unit/integration tests against real sql.js and real WebCrypto/Argon2id |
| PDF extraction | **Synthetic** statements generated with ReportLab (`tests/fixtures/make_pdfs.py`): two layouts, multi-page, wrapped narration |
| UI flows | One jsdom + Testing Library smoke test: onboarding, every screen, add transaction, NL bar, hotkey lock, wrong then right passphrase, data persisted through encrypted save |
| **Not exercised** | A real browser (none available in the build sandbox): layout, visual polish, service worker, IndexedDB quotas, the import Web Worker, real bank PDFs, screen readers |

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

## Known gaps (honest list)
* PDF accuracy is **100% on my synthetic statements**. The "≥ 95% on typical bank PDFs" criterion is **unverified** against real Nigerian bank layouts; expect to add templates or fix heuristics once real files are tried. The importer shows a confidence per row and a "statement check" (opening + rows = closing) precisely so mistakes are visible.
* Interrupted *page close* during a save relies on IndexedDB's own atomic transaction; not simulated beyond the failure injection above.
* UI visuals, keyboard flow in a real browser, and the service worker have not been run in a browser.
