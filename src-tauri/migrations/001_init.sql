-- 001_init.sql

CREATE TABLE categories (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  type  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO categories (name, type) VALUES
  ('Groceries', 0), ('Dining', 0), ('Transport', 0), ('Shopping', 0), ('Utilities', 0), ('Housing', 0),
  ('Subscriptions', 0), ('Health', 0), ('Income', 1), ('Transfer', 2), ('Credit Card Payment', 0),
  ('Loan', 0), ('Taxes', 0), ('Other', 0), ('Investment', 3), ('Property Taxes', 0);

CREATE TABLE merchants (
  id           INTEGER PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,                -- merchant_key(), e.g. "PGANDE"
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,   -- NULL = not categorized yet
  source       TEXT                                 -- 'llm' | 'user'
);

CREATE TABLE transactions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  date                    TEXT NOT NULL,
  description             TEXT NOT NULL,
  amount                  FLOAT NOT NULL,
  running_balance         FLOAT,
  source                  TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  unique_transaction_key  TEXT NOT NULL DEFAULT '',
  merchant_id             INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
  category_id             INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  -- 1 when you changed this one transaction's category yourself; merchant updates skip it
  category_overridden     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX transactions_unique_key   ON transactions (unique_transaction_key);
CREATE INDEX        transactions_category_date ON transactions (category_id, date);
CREATE INDEX        transactions_merchant      ON transactions (merchant_id);
