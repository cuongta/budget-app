use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

use crate::categorize::merchant_key;
use crate::csv_parser::Transaction;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, sqlx::Type)]
#[repr(i64)]
pub enum CategoryType {
    Expense = 0,
    Income = 1,
    Transfer = 2,
    Investment = 3,
}

/// A row as stored in the `transactions` table.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StoredTransaction {
    pub id: i64,
    pub date: String,
    pub unique_transaction_key: String,
    pub description: String,
    pub amount: f64,
    pub running_balance: Option<f64>,
    pub source: Option<String>,
    /// NULL until the transaction is linked to a merchant at import.
    pub merchant_id: Option<i64>,
    /// NULL = not categorized yet.
    pub category_id: Option<i64>,
    /// True when the category was set on this transaction by hand; merchant
    /// category changes skip it.
    pub category_overridden: bool,
    pub created_at: String,
}

/// Opens (creating if needed) the database file and runs pending migrations.
pub async fn open(path: &Path) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

/// Inserts all rows in one transaction: either the whole batch lands or nothing does.
/// Each row is linked to its merchant (created if new) and gets the merchant's
/// category, if it has one.
pub async fn insert_transactions(
    pool: &SqlitePool,
    rows: &[Transaction],
) -> sqlx::Result<(usize, usize)> {
    let mut tx = pool.begin().await?;
    let mut inserted = 0;
    for t in rows {
        let key = merchant_key(&t.description);
        sqlx::query("INSERT INTO merchants (key) VALUES ($1) ON CONFLICT (key) DO NOTHING")
            .bind(&key)
            .execute(&mut *tx)
            .await?;
        // category_id is NULL for a merchant nobody has categorized yet.
        let (merchant_id, category_id): (i64, Option<i64>) =
            sqlx::query_as("SELECT id, category_id FROM merchants WHERE key = $1")
                .bind(&key)
                .fetch_one(&mut *tx)
                .await?;

        let result = sqlx::query(
            "INSERT INTO transactions \
               (date, description, amount, running_balance, source, unique_transaction_key, merchant_id, category_id) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (unique_transaction_key) DO NOTHING",
        )
        .bind(&t.date)
        .bind(&t.description)
        .bind(t.amount)
        .bind(t.running_balance)
        .bind(&t.source)
        .bind(&t.unique_transaction_key)
        .bind(merchant_id)
        .bind(category_id)
        .execute(&mut *tx)
        .await?;
        inserted += result.rows_affected() as usize;
    }
    tx.commit().await?;
    Ok((inserted, rows.len()))
}

pub async fn list_transactions(pool: &SqlitePool) -> sqlx::Result<Vec<StoredTransaction>> {
    sqlx::query_as("SELECT * FROM transactions ORDER BY date DESC, id DESC")
        .fetch_all(pool)
        .await
}

/// One page of results plus what the UI needs to render page controls.
#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    /// 1-based page number that was returned.
    pub page: u32,
    pub page_size: u32,
    /// Total rows across all pages.
    pub total: i64,
}

pub const MAX_PAGE_SIZE: u32 = 500;

/// Newest first, same order as `list_transactions`. `page` is 1-based; out-of-range
/// pages return an empty `items`.
pub async fn list_transactions_page(
    pool: &SqlitePool,
    page: u32,
    page_size: u32,
) -> sqlx::Result<Page<StoredTransaction>> {
    // Treat page 0 as page 1, so `page - 1` below can't go negative.
    let page = page.max(1);
    // At least 1 row per page; at most MAX_PAGE_SIZE so a caller can't fetch the
    // whole table in one request.
    let page_size = page_size.clamp(1, MAX_PAGE_SIZE);
    // Rows to skip before this page: page 1 skips 0, page 2 skips page_size, ...
    // Computed in i64 because u32 * u32 can overflow, and sqlx binds SQLite
    // integers as i64.
    let offset = (page as i64 - 1) * page_size as i64;

    // Total across all pages, so the UI can show "page 2 of 7"
    // (pages = ceil(total / page_size)).
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
        .fetch_one(pool)
        .await?;

    // ORDER BY must give every row a fixed position, or a row could appear on two
    // pages (or none) when SQLite orders same-day rows differently between queries.
    // `id DESC` breaks ties between same-day rows.
    // LIMIT = how many rows to return; OFFSET = how many to skip first.
    let items =
        sqlx::query_as("SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT $1 OFFSET $2")
            .bind(page_size as i64)
            .bind(offset)
            .fetch_all(pool)
            .await?;

    // Return the page/page_size actually used (after clamping), not what was asked
    // for, so the UI's page controls match the data.
    Ok(Page {
        items,
        page,
        page_size,
        total,
    })
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Category {
    pub id: i64,
    pub name: String,
    /// `type` is a Rust keyword, so the column is renamed.
    #[sqlx(rename = "type")]
    pub kind: CategoryType,
}

pub async fn list_categories(pool: &SqlitePool) -> sqlx::Result<Vec<Category>> {
    sqlx::query_as("SELECT id, name, type FROM categories ORDER BY name")
        .fetch_all(pool)
        .await
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Merchant {
    pub id: i64,
    pub key: String,
    /// NULL = not categorized yet.
    pub category_id: Option<i64>,
    /// 'user' or 'llm'; NULL while uncategorized.
    pub source: Option<String>,
    pub transaction_count: i64,
}

/// All merchants, most transactions first, so the ones worth categorizing come first.
pub async fn list_merchants(pool: &SqlitePool) -> sqlx::Result<Vec<Merchant>> {
    sqlx::query_as(
        "SELECT m.id, m.key, m.category_id, m.source, COUNT(t.id) AS transaction_count \
         FROM merchants m LEFT JOIN transactions t ON t.merchant_id = m.id \
         GROUP BY m.id ORDER BY transaction_count DESC, m.key",
    )
    .fetch_all(pool)
    .await
}

/// Merchants with no category that still have transactions; those are the ones whose
/// transactions are left uncategorized.
pub async fn count_uncategorized_merchants(pool: &SqlitePool) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM merchants m WHERE m.category_id IS NULL \
         AND EXISTS (SELECT 1 FROM transactions t WHERE t.merchant_id = m.id)",
    )
    .fetch_one(pool)
    .await
}

/// Sets a merchant's category (as chosen by the user) and applies it to all of the
/// merchant's transactions, past and future, except ones overridden individually.
/// Returns how many transactions were updated; `RowNotFound` if the merchant doesn't exist.
pub async fn set_merchant_category(
    pool: &SqlitePool,
    merchant_id: i64,
    category_id: i64,
) -> sqlx::Result<u64> {
    let mut tx = pool.begin().await?;
    let merchant =
        sqlx::query("UPDATE merchants SET category_id = $1, source = 'user' WHERE id = $2")
            .bind(category_id)
            .bind(merchant_id)
            .execute(&mut *tx)
            .await?;
    if merchant.rows_affected() == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    let transactions = sqlx::query(
        "UPDATE transactions SET category_id = $1 WHERE merchant_id = $2 AND category_overridden = 0",
    )
    .bind(category_id)
    .bind(merchant_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(transactions.rows_affected())
}

/// `Some(category)`: sets this one transaction's category and marks it overridden, so
/// later merchant changes leave it alone.
/// `None`: removes the override; the transaction goes back to its merchant's category.
/// Returns false if the transaction doesn't exist.
pub async fn set_transaction_category(
    pool: &SqlitePool,
    id: i64,
    category_id: Option<i64>,
) -> sqlx::Result<bool> {
    let result = match category_id {
        Some(category_id) => {
            sqlx::query("UPDATE transactions SET category_id = $1, category_overridden = 1 WHERE id = $2")
                .bind(category_id)
                .bind(id)
                .execute(pool)
                .await?
        }
        None => {
            sqlx::query(
                "UPDATE transactions SET category_overridden = 0, \
                   category_id = (SELECT category_id FROM merchants WHERE id = transactions.merchant_id) \
                 WHERE id = $1",
            )
            .bind(id)
            .execute(pool)
            .await?
        }
    };
    Ok(result.rows_affected() > 0)
}

/// Net amount per category per month. `total` keeps the bank's sign: spending is
/// negative, income positive, and a refund in an expense category offsets its spending.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MonthlyCategoryTotal {
    /// "YYYY-MM"
    pub month: String,
    /// NULL for uncategorized transactions.
    pub category_id: Option<i64>,
    pub category: String,
    pub kind: Option<CategoryType>,
    pub total: f64,
}

/// Every month × category that has transactions, oldest month first.
pub async fn monthly_category_totals(pool: &SqlitePool) -> sqlx::Result<Vec<MonthlyCategoryTotal>> {
    // Works because dates are stored as YYYY-MM-DD (see csv_parser::parse_date).
    sqlx::query_as(
        "SELECT strftime('%Y-%m', t.date) AS month, \
                c.id AS category_id, \
                COALESCE(c.name, 'Uncategorized') AS category, \
                c.type AS kind, \
                SUM(t.amount) AS total \
         FROM transactions t \
         LEFT JOIN categories c ON c.id = t.category_id \
         GROUP BY month, c.id \
         ORDER BY month, category",
    )
    .fetch_all(pool)
    .await
}

/// A transaction with its merchant and category names, for list views.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TransactionView {
    pub id: i64,
    pub date: String,
    pub description: String,
    pub amount: f64,
    pub running_balance: Option<f64>,
    pub merchant_id: Option<i64>,
    pub merchant: Option<String>,
    pub category_id: Option<i64>,
    pub category: Option<String>,
    pub kind: Option<CategoryType>,
    pub category_overridden: bool,
}

/// Transactions in one month ("YYYY-MM"), newest first.
pub async fn list_month_transactions(
    pool: &SqlitePool,
    month: &str,
) -> sqlx::Result<Vec<TransactionView>> {
    // A date range (not strftime on each row) so the comparison works on the stored
    // YYYY-MM-DD text directly: [YYYY-MM-01, first day of next month).
    sqlx::query_as(
        "SELECT t.id, t.date, t.description, t.amount, t.running_balance, \
                t.merchant_id, m.key AS merchant, \
                t.category_id, c.name AS category, c.type AS kind, t.category_overridden \
         FROM transactions t \
         LEFT JOIN merchants m ON m.id = t.merchant_id \
         LEFT JOIN categories c ON c.id = t.category_id \
         WHERE t.date >= $1 || '-01' AND t.date < date($1 || '-01', '+1 month') \
         ORDER BY t.date DESC, t.id DESC",
    )
    .bind(month)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Serialize)]
pub struct ResetSummary {
    pub transactions: u64,
    pub merchants: u64,
}

/// Deletes every transaction, and every merchant (with its category) when
/// `include_merchants`; categories themselves are kept. All or nothing.
/// Keeping merchants means a re-import is categorized automatically.
pub async fn reset_data(pool: &SqlitePool, include_merchants: bool) -> sqlx::Result<ResetSummary> {
    let mut tx = pool.begin().await?;
    let transactions = sqlx::query("DELETE FROM transactions")
        .execute(&mut *tx)
        .await?
        .rows_affected();
    // After the transactions, since they reference merchants.
    let merchants = if include_merchants {
        sqlx::query("DELETE FROM merchants")
            .execute(&mut *tx)
            .await?
            .rows_affected()
    } else {
        0
    };
    tx.commit().await?;
    Ok(ResetSummary {
        transactions,
        merchants,
    })
}

/// Returns whether a row was deleted.
pub async fn delete_transaction(pool: &SqlitePool, id: i64) -> sqlx::Result<bool> {
    let result = sqlx::query("DELETE FROM transactions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn create_category(
    pool: &SqlitePool,
    name: &str,
    kind: CategoryType,
) -> sqlx::Result<Category> {
    sqlx::query_as("INSERT INTO categories (name, type) VALUES ($1, $2) RETURNING id, name, type")
        .bind(name.trim())
        .bind(kind)
        .fetch_one(pool)
        .await
}

pub async fn rename_category(pool: &SqlitePool, id: i64, name: &str) -> sqlx::Result<bool> {
    let res = sqlx::query("UPDATE categories SET name = $1 WHERE id = $2")
        .bind(name.trim())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Deletes a category; its merchants and transactions become uncategorized (and
/// transactions lose their override). All or nothing. Returns false if it didn't exist.
pub async fn delete_category(pool: &SqlitePool, id: i64) -> sqlx::Result<bool> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE transactions SET category_overridden = 0, category_id = NULL WHERE category_id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE merchants SET category_id = NULL WHERE category_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query("DELETE FROM categories WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(res.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    // One connection: each connection to `:memory:` would otherwise get its own empty database.
    async fn memory_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn make_txn(date: &str, description: &str, amount: f64, running_balance: f64) -> Transaction {
        let date: String = date.into();
        Transaction {
            unique_transaction_key: format!("{}-{}-{}", date.clone(), amount, running_balance),
            date,
            description: description.into(),
            amount,
            running_balance: running_balance,
            source: "test.csv".into(),
        }
    }

    #[tokio::test]
    async fn insert_list_delete() {
        let pool = memory_pool().await;
        let dont_care = 0.0;
        let rows = [
            make_txn("2026-09-02", "PAYROLL", 2500.0, dont_care),
            make_txn("2026-09-03", "COFFEE", -4.75, dont_care),
        ];
        assert_eq!(insert_transactions(&pool, &rows).await.unwrap().0, 2);
        assert_eq!(insert_transactions(&pool, &rows).await.unwrap().1, 2);

        let stored = list_transactions(&pool).await.unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].description, "COFFEE"); // newest first
        assert_eq!(stored[0].amount, -4.75);
        assert_eq!(stored[0].source.as_deref(), Some("test.csv"));

        assert!(delete_transaction(&pool, stored[0].id).await.unwrap());
        assert!(!delete_transaction(&pool, stored[0].id).await.unwrap());
        assert_eq!(list_transactions(&pool).await.unwrap().len(), 1);
    }

    async fn category_id(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query_scalar("SELECT id FROM categories WHERE name = $1")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn import_links_merchants_and_copies_their_category() {
        let pool = memory_pool().await;
        let utilities = category_id(&pool, "Utilities").await;
        sqlx::query(
            "INSERT INTO merchants (key, category_id, source) VALUES ('CITYPOWER', $1, 'user')",
        )
        .bind(utilities)
        .execute(&pool)
        .await
        .unwrap();

        let rows = [
            make_txn(
                "2026-09-02",
                "CITYPOWER DES:WEB ONLINE ID:11112222333344 INDN:JANE DOE CO ID:2222222222 WEB",
                -80.0,
                1.0,
            ),
            make_txn(
                "2026-10-02",
                "CITYPOWER DES:WEB ONLINE ID:55556666777788 INDN:JANE DOE CO ID:2222222222 WEB",
                -95.0,
                2.0,
            ),
            make_txn(
                "2026-09-21",
                "ACME-CABLE DES:CABLE SVCS ID:1234567 INDN:JANE *DOE CO ID:0000333333 PPD",
                -66.47,
                3.0,
            ),
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        // Re-importing must not create duplicate merchants (or transactions).
        assert_eq!(insert_transactions(&pool, &rows).await.unwrap().0, 0);

        let merchants: Vec<(i64, String)> =
            sqlx::query_as("SELECT id, key FROM merchants ORDER BY key")
                .fetch_all(&pool)
                .await
                .unwrap();
        let keys: Vec<&str> = merchants.iter().map(|(_, k)| k.as_str()).collect();
        assert_eq!(keys, ["ACME-CABLE", "CITYPOWER"]);
        let (cable_id, citypower_id) = (merchants[0].0, merchants[1].0);

        for t in list_transactions(&pool).await.unwrap() {
            if t.description.starts_with("CITYPOWER") {
                assert_eq!(t.merchant_id, Some(citypower_id));
                assert_eq!(
                    t.category_id,
                    Some(utilities),
                    "known merchant's category is copied"
                );
            } else {
                assert_eq!(t.merchant_id, Some(cable_id));
                assert_eq!(t.category_id, None, "new merchant has no category yet");
            }
            assert!(!t.category_overridden);
        }
    }

    #[tokio::test]
    async fn merchant_category_applies_to_transactions_except_overrides() {
        let pool = memory_pool().await;
        let rows = [
            make_txn("2026-09-02", "AMAZON", -10.0, 1.0),
            make_txn("2026-09-03", "AMAZON", -20.0, 2.0),
            make_txn("2026-09-04", "AMAZON", -30.0, 3.0),
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        let (shopping, groceries, dining) = (
            category_id(&pool, "Shopping").await,
            category_id(&pool, "Groceries").await,
            category_id(&pool, "Dining").await,
        );
        let merchants = list_merchants(&pool).await.unwrap();
        assert_eq!(merchants.len(), 1);
        assert_eq!(merchants[0].transaction_count, 3);
        let amazon = merchants[0].id;
        let by_amount = |ts: &[StoredTransaction], amount: f64| {
            ts.iter().find(|t| t.amount == amount).unwrap().category_id
        };

        // Merchant category reaches all its transactions.
        assert_eq!(
            set_merchant_category(&pool, amazon, shopping)
                .await
                .unwrap(),
            3
        );

        // Override one; a later merchant change skips it.
        let ts = list_transactions(&pool).await.unwrap();
        let gift = ts.iter().find(|t| t.amount == -20.0).unwrap().id;
        assert!(set_transaction_category(&pool, gift, Some(groceries))
            .await
            .unwrap());
        assert_eq!(
            set_merchant_category(&pool, amazon, dining).await.unwrap(),
            2
        );
        let ts = list_transactions(&pool).await.unwrap();
        assert_eq!(by_amount(&ts, -10.0), Some(dining));
        assert_eq!(by_amount(&ts, -20.0), Some(groceries));
        assert_eq!(by_amount(&ts, -30.0), Some(dining));

        // Clearing the override goes back to the merchant's category.
        assert!(set_transaction_category(&pool, gift, None).await.unwrap());
        let ts = list_transactions(&pool).await.unwrap();
        assert_eq!(by_amount(&ts, -20.0), Some(dining));
        assert!(ts.iter().all(|t| !t.category_overridden));

        let m = &list_merchants(&pool).await.unwrap()[0];
        assert_eq!(
            (m.category_id, m.source.as_deref()),
            (Some(dining), Some("user"))
        );
    }

    #[tokio::test]
    async fn set_category_rejects_unknown_ids() {
        let pool = memory_pool().await;
        insert_transactions(&pool, &[make_txn("2026-09-02", "AMAZON", -10.0, 1.0)])
            .await
            .unwrap();
        let amazon = list_merchants(&pool).await.unwrap()[0].id;
        let shopping = category_id(&pool, "Shopping").await;

        assert!(matches!(
            set_merchant_category(&pool, 999, shopping).await,
            Err(sqlx::Error::RowNotFound)
        ));
        assert!(!set_transaction_category(&pool, 999, Some(shopping))
            .await
            .unwrap());
        // Foreign key: category 999 doesn't exist.
        assert!(set_merchant_category(&pool, amazon, 999).await.is_err());

        let categories = list_categories(&pool).await.unwrap();
        let income = categories.iter().find(|c| c.name == "Income").unwrap();
        assert_eq!(income.kind, CategoryType::Income);
    }

    #[tokio::test]
    async fn monthly_totals_group_by_month_and_category() {
        let pool = memory_pool().await;
        let rows = [
            make_txn("2026-09-02", "SAFEWAY", -50.0, 1.0),
            make_txn("2026-09-20", "SAFEWAY", -30.0, 2.0),
            make_txn("2026-09-25", "SAFEWAY", 10.0, 3.0), // refund
            make_txn("2026-09-30", "PAYROLL", 2500.0, 4.0),
            make_txn("2026-10-01", "SAFEWAY", -40.0, 5.0),
            make_txn("2026-10-02", "MYSTERY SHOP", -7.0, 6.0), // merchant never categorized
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        let merchant = |key: &str| {
            let key = key.to_string();
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>("SELECT id FROM merchants WHERE key = $1")
                    .bind(key)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            }
        };
        let groceries = category_id(&pool, "Groceries").await;
        let income = category_id(&pool, "Income").await;
        set_merchant_category(&pool, merchant("SAFEWAY").await, groceries)
            .await
            .unwrap();
        set_merchant_category(&pool, merchant("PAYROLL").await, income)
            .await
            .unwrap();

        let totals = monthly_category_totals(&pool).await.unwrap();
        let got: Vec<(&str, &str, Option<CategoryType>, f64)> = totals
            .iter()
            .map(|t| (t.month.as_str(), t.category.as_str(), t.kind, t.total))
            .collect();
        assert_eq!(
            got,
            [
                ("2026-09", "Groceries", Some(CategoryType::Expense), -70.0),
                ("2026-09", "Income", Some(CategoryType::Income), 2500.0),
                ("2026-10", "Groceries", Some(CategoryType::Expense), -40.0),
                ("2026-10", "Uncategorized", None, -7.0),
            ]
        );
    }

    #[tokio::test]
    async fn month_transactions_include_names_and_stay_in_month() {
        let pool = memory_pool().await;
        let rows = [
            make_txn("2026-08-31", "SAFEWAY", -1.0, 1.0),
            make_txn("2026-09-01", "SAFEWAY", -2.0, 2.0),
            make_txn("2026-09-30", "MYSTERY SHOP", -3.0, 3.0),
            make_txn("2026-10-01", "SAFEWAY", -4.0, 4.0),
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        let safeway = list_merchants(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|m| m.key == "SAFEWAY")
            .unwrap()
            .id;
        let groceries = category_id(&pool, "Groceries").await;
        set_merchant_category(&pool, safeway, groceries)
            .await
            .unwrap();

        let september = list_month_transactions(&pool, "2026-09").await.unwrap();
        let got: Vec<(&str, Option<&str>, Option<&str>, Option<CategoryType>)> = september
            .iter()
            .map(|t| {
                (
                    t.date.as_str(),
                    t.merchant.as_deref(),
                    t.category.as_deref(),
                    t.kind,
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                ("2026-09-30", Some("MYSTERY SHOP"), None, None),
                (
                    "2026-09-01",
                    Some("SAFEWAY"),
                    Some("Groceries"),
                    Some(CategoryType::Expense)
                ),
            ]
        );
        // December -> January rollover in the date range.
        assert!(list_month_transactions(&pool, "2026-12")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn uncategorized_count_skips_categorized_and_idle_merchants() {
        let pool = memory_pool().await;
        let rows = [
            make_txn("2026-09-02", "SAFEWAY", -50.0, 1.0),
            make_txn("2026-09-03", "PETCO", -20.0, 2.0),
            make_txn("2026-09-04", "MYSTERY SHOP", -7.0, 3.0),
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        assert_eq!(count_uncategorized_merchants(&pool).await.unwrap(), 3);

        let safeway = list_merchants(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|m| m.key == "SAFEWAY")
            .unwrap()
            .id;
        let groceries = category_id(&pool, "Groceries").await;
        set_merchant_category(&pool, safeway, groceries)
            .await
            .unwrap();
        assert_eq!(count_uncategorized_merchants(&pool).await.unwrap(), 2);

        // Merchants without transactions (kept by a reset) don't skew any totals.
        reset_data(&pool, false).await.unwrap();
        assert_eq!(count_uncategorized_merchants(&pool).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn reset_keeps_merchant_categories_unless_asked() {
        let pool = memory_pool().await;
        let rows = [
            make_txn("2026-09-02", "CITYPOWER", -80.0, 1.0),
            make_txn("2026-09-03", "ACME-CABLE", -66.0, 2.0),
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        let citypower = list_merchants(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|m| m.key == "CITYPOWER")
            .unwrap()
            .id;
        let utilities = category_id(&pool, "Utilities").await;
        set_merchant_category(&pool, citypower, utilities)
            .await
            .unwrap();

        // Transactions only: merchants and their categories survive...
        let summary = reset_data(&pool, false).await.unwrap();
        assert_eq!((summary.transactions, summary.merchants), (2, 0));
        assert!(list_transactions(&pool).await.unwrap().is_empty());
        assert_eq!(list_merchants(&pool).await.unwrap().len(), 2);
        // ...so a re-import is categorized again right away.
        insert_transactions(&pool, &rows).await.unwrap();
        let pg = list_transactions(&pool)
            .await
            .unwrap()
            .into_iter()
            .find(|t| t.description == "CITYPOWER")
            .unwrap();
        assert_eq!(pg.category_id, Some(utilities));

        // Everything: merchants go too; categories stay.
        let summary = reset_data(&pool, true).await.unwrap();
        assert_eq!((summary.transactions, summary.merchants), (2, 2));
        assert!(list_merchants(&pool).await.unwrap().is_empty());
        assert!(!list_categories(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn pages_cover_every_row_once() {
        let pool = memory_pool().await;
        // 5 rows; two share a date, so ordering relies on the id tie-breaker.
        let rows: Vec<_> = [1, 2, 3, 3, 4]
            .iter()
            .enumerate()
            .map(|(i, day)| make_txn(&format!("2026-09-0{day}"), &format!("T{i}"), 1.0, i as f64))
            .collect();
        insert_transactions(&pool, &rows).await.unwrap();

        let p1 = list_transactions_page(&pool, 1, 2).await.unwrap();
        let p2 = list_transactions_page(&pool, 2, 2).await.unwrap();
        let p3 = list_transactions_page(&pool, 3, 2).await.unwrap();
        assert_eq!((p1.total, p1.page, p1.page_size), (5, 1, 2));
        let ids: Vec<i64> = [&p1, &p2, &p3]
            .iter()
            .flat_map(|p| p.items.iter().map(|t| t.id))
            .collect();
        let all: Vec<i64> = list_transactions(&pool)
            .await
            .unwrap()
            .iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, all);

        assert!(list_transactions_page(&pool, 4, 2)
            .await
            .unwrap()
            .items
            .is_empty());
        // page 0 is treated as page 1; page_size is clamped
        assert_eq!(list_transactions_page(&pool, 0, 2).await.unwrap().page, 1);
        assert_eq!(
            list_transactions_page(&pool, 1, 10_000)
                .await
                .unwrap()
                .page_size,
            MAX_PAGE_SIZE
        );
    }

    #[tokio::test]
    async fn test_create_category() {
        let pool = memory_pool().await;
        let count_before_inserts = list_categories(&pool).await.unwrap().len();
        create_category(&pool, "a", CategoryType::Expense)
            .await
            .unwrap();
        create_category(&pool, "b", CategoryType::Investment)
            .await
            .unwrap();
        create_category(&pool, "c", CategoryType::Transfer)
            .await
            .unwrap();
        let d = create_category(&pool, " d ", CategoryType::Income)
            .await
            .unwrap();
        assert_eq!(d.name, "d"); // trimmed
        assert_eq!(d.kind, CategoryType::Income);
        let duplicate = create_category(&pool, "d", CategoryType::Income)
            .await
            .unwrap_err();
        assert!(is_unique_violation(&duplicate));
        let count_after_inserts = list_categories(&pool).await.unwrap().len();
        assert_eq!(count_after_inserts, count_before_inserts + 4);
    }

    #[tokio::test]
    async fn rename_category_keeps_names_unique() {
        let pool = memory_pool().await;
        let pets = create_category(&pool, "Pets", CategoryType::Expense)
            .await
            .unwrap();

        assert!(rename_category(&pool, pets.id, "Pet care").await.unwrap());
        assert_eq!(category_id(&pool, "Pet care").await, pets.id);

        let err = rename_category(&pool, pets.id, "Groceries")
            .await
            .unwrap_err();
        assert!(is_unique_violation(&err));
        assert!(!rename_category(&pool, 999, "Nope").await.unwrap());
    }

    #[tokio::test]
    async fn delete_category_uncategorizes_merchants_and_transactions() {
        let pool = memory_pool().await;
        let rows = [
            make_txn("2026-09-02", "PETCO", -10.0, 1.0),
            make_txn("2026-09-03", "PETCO", -20.0, 2.0),
        ];
        insert_transactions(&pool, &rows).await.unwrap();
        let petco = list_merchants(&pool).await.unwrap()[0].id;
        let pets = create_category(&pool, "Pets", CategoryType::Expense)
            .await
            .unwrap();
        set_merchant_category(&pool, petco, pets.id).await.unwrap();
        // One transaction overridden to the category being deleted.
        let overridden = list_transactions(&pool).await.unwrap()[0].id;
        set_transaction_category(&pool, overridden, Some(pets.id))
            .await
            .unwrap();

        assert!(delete_category(&pool, pets.id).await.unwrap());

        assert!(list_categories(&pool)
            .await
            .unwrap()
            .iter()
            .all(|c| c.id != pets.id));
        assert_eq!(list_merchants(&pool).await.unwrap()[0].category_id, None);
        for t in list_transactions(&pool).await.unwrap() {
            assert_eq!(t.category_id, None);
            assert!(!t.category_overridden);
        }
        assert!(!delete_category(&pool, pets.id).await.unwrap());
    }

    fn is_unique_violation(e: &sqlx::Error) -> bool {
        e.as_database_error()
            .is_some_and(|d| d.is_unique_violation())
    }
}
