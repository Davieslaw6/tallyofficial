# Database schema (SQLite, versioned migrations in `src/core/schema.ts`)

Migration runner: `schema_migrations(version, name, applied_at)`; each migration runs in a transaction. Currently v1 `initial`, v2 `attachments`.

| Table | Purpose / key columns |
|---|---|
| `accounts` | `name`, `kind` (checking/savings/credit/cash/investment), `opening_balance` (kobo), `opening_date`, `archived` |
| `categories` | `name` (unique per profile), `kind` income/expense/transfer, `color` |
| `transactions` | `account_id`, `date` (ISO, CHECK GLOB), `amount` (kobo, negative = out), `description`, `merchant` (normalised), `category_id`, `tags`, `notes`, `transfer_group`, `is_split`, `source`, `import_hash`, `statement_id`, `recurring_id`, `confidence`, `attachment_hash` |
| `splits` | `transaction_id` (cascade), `category_id`, `amount`, `note` |
| `recurring` | `account_id`, `description`, `amount`, `frequency` (weekly…yearly), `next_due`, `active` |
| `budgets` | `category_id` (unique), `monthly_limit` > 0, `alert_at` |
| `goals` | `name`, `target_amount` > 0, `target_date`, `saved` |
| `statements` | `account_id`, `file_hash` (unique per account), period, opening/closing balances |
| `merchant_rules` | `pattern` → `category_id` (user-remembered merchants) |
| `model_state` | persisted Naive Bayes JSON per profile |
| `attachments` | receipts: `hash` PK, `name`, `mime`, `size`, `data` BLOB (inside the encrypted DB) |
| `audit_log` | `ts`, `event`, `detail`, `prev_hash`, `hash`; triggers forbid UPDATE/DELETE |
| `settings` | key/value (reserved) |

Indexes: `(profile_id, date)`, `(profile_id, category_id)`, `(account_id, date)`, unique `(account_id, import_hash)` where not null; `splits(transaction_id)`.

Invariants enforced in code and tested: splits sum to parent exactly and share its sign; transfers have two legs and are not income/expense; deleting a transfer leg deletes both; imports are atomic; the same statement file cannot be imported twice into one account.
