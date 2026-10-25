-- 002_more_categories.sql

-- More common categories. type: 0 = Expense, 1 = Income, 2 = Transfer, 3 = Investment
-- (db::CategoryType). OR IGNORE skips any name already added on the Categories
-- page, which would otherwise fail the UNIQUE constraint and stop the app starting.
INSERT OR IGNORE INTO categories (name, type) VALUES
  ('Car Payment', 0),
  ('Childcare', 0),
  ('Education', 0),
  ('Entertainment', 0),
  ('Fees & Charges', 0),
  ('Gas & Fuel', 0),
  ('Gifts & Donations', 0),
  ('Home Improvement', 0),
  ('Insurance', 0),
  ('Mortgage', 0),
  ('Personal Care', 0),
  ('Pets', 0),
  ('Phone & Internet', 0),
  ('Rent', 0),
  ('Travel', 0),
  ('Interest', 1),
  ('Retirement', 3);
