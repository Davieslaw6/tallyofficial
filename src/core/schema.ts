export interface Migration { version: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1, name: 'initial',
    sql: `
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('checking','savings','credit','cash','investment')),
  opening_balance INTEGER NOT NULL DEFAULT 0, opening_date TEXT, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
  color TEXT, UNIQUE (profile_id, name)
);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount INTEGER NOT NULL,               -- kobo; negative = money out
  description TEXT NOT NULL, merchant TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id),
  tags TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  transfer_group TEXT,                   -- shared id on both legs of a transfer
  is_split INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- manual|csv|ofx|qif|pdf|recurring
  import_hash TEXT, statement_id INTEGER, recurring_id INTEGER,
  confidence REAL, attachment_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tx_profile_date ON transactions(profile_id, date);
CREATE INDEX idx_tx_profile_cat ON transactions(profile_id, category_id);
CREATE INDEX idx_tx_account_date ON transactions(account_id, date);
CREATE UNIQUE INDEX idx_tx_import_hash ON transactions(account_id, import_hash) WHERE import_hash IS NOT NULL;
CREATE TABLE splits (
  id INTEGER PRIMARY KEY, transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id), amount INTEGER NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_splits_tx ON splits(transaction_id);
CREATE TABLE recurring (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER NOT NULL REFERENCES accounts(id), description TEXT NOT NULL,
  amount INTEGER NOT NULL, category_id INTEGER REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
  next_due TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  category_id INTEGER NOT NULL REFERENCES categories(id), monthly_limit INTEGER NOT NULL CHECK (monthly_limit > 0),
  alert_at REAL NOT NULL DEFAULT 0.8, UNIQUE (profile_id, category_id)
);
CREATE TABLE goals (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL, target_amount INTEGER NOT NULL CHECK (target_amount > 0), target_date TEXT,
  saved INTEGER NOT NULL DEFAULT 0, account_id INTEGER REFERENCES accounts(id)
);
CREATE TABLE statements (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER NOT NULL REFERENCES accounts(id), file_hash TEXT NOT NULL,
  period_start TEXT, period_end TEXT, opening_balance INTEGER, closing_balance INTEGER,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (account_id, file_hash)
);
CREATE TABLE merchant_rules (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL DEFAULT 1,
  pattern TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
  source TEXT NOT NULL DEFAULT 'user', UNIQUE (profile_id, pattern)
);
CREATE TABLE model_state (profile_id INTEGER PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
  {
    version: 2, name: 'attachments',
    sql: `CREATE TABLE attachments (hash TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);`,
  },
];

export const DEFAULT_CATEGORIES: { name: string; kind: 'income' | 'expense' | 'transfer'; color: string }[] = [
  { name: 'Salary', kind: 'income', color: '#1E7F5C' },
  { name: 'Other income', kind: 'income', color: '#4F9D7C' },
  { name: 'Groceries', kind: 'expense', color: '#2F3C9E' },
  { name: 'Eating out', kind: 'expense', color: '#A8204E' },
  { name: 'Transport', kind: 'expense', color: '#6A5ACD' },
  { name: 'Fuel', kind: 'expense', color: '#8A5A00' },
  { name: 'Rent', kind: 'expense', color: '#3B4A7A' },
  { name: 'Utilities', kind: 'expense', color: '#2A7F9E' },
  { name: 'Airtime & data', kind: 'expense', color: '#C0408A' },
  { name: 'Subscriptions', kind: 'expense', color: '#7A3FA0' },
  { name: 'Health', kind: 'expense', color: '#B3541E' },
  { name: 'Education', kind: 'expense', color: '#2D6A4F' },
  { name: 'Shopping', kind: 'expense', color: '#9E2F4F' },
  { name: 'Entertainment', kind: 'expense', color: '#5C6BC0' },
  { name: 'Bank fees', kind: 'expense', color: '#6B7280' },
  { name: 'Gifts & giving', kind: 'expense', color: '#BF6A2A' },
  { name: 'Other', kind: 'expense', color: '#8A90A6' },
  { name: 'Transfer', kind: 'transfer', color: '#9AA0B8' },
];
