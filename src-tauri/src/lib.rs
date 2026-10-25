mod categorize;
mod csv_parser;
mod db;

use csv_parser::*;
use db::{
    Category, Merchant, MonthlyCategoryTotal, Page, ResetSummary, StoredTransaction,
    TransactionView,
};
use sqlx::SqlitePool;
use tauri::{Manager, State};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Imports one Bank of America CSV export; `path` comes from the file picker.
/// Returns (inserted, total): rows already imported are skipped.
#[tauri::command]
async fn import_csv(pool: State<'_, SqlitePool>, path: String) -> Result<(usize, usize), String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("couldn't read {path}: {e}"))?;
    let source = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(path.clone());
    let rows = parse_csv(&String::from_utf8_lossy(&bytes), &source)?;
    db::insert_transactions(&pool, &rows)
        .await
        .map_err(|e| e.to_string())
}

/// Deletes all transactions (and merchants too when `include_merchants`), to start over.
#[tauri::command]
async fn reset_data(
    pool: State<'_, SqlitePool>,
    include_merchants: bool,
) -> Result<ResetSummary, String> {
    db::reset_data(&pool, include_merchants)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_transactions(pool: State<'_, SqlitePool>) -> Result<Vec<StoredTransaction>, String> {
    db::list_transactions(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_paginate_transactions(
    pool: State<'_, SqlitePool>,
    page: u32,
    page_size: u32,
) -> Result<Page<StoredTransaction>, String> {
    db::list_transactions_page(&pool, page, page_size)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_transaction(pool: State<'_, SqlitePool>, id: i64) -> Result<bool, String> {
    db::delete_transaction(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_categories(pool: State<'_, SqlitePool>) -> Result<Vec<Category>, String> {
    db::list_categories(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_category(
    pool: State<'_, SqlitePool>,
    name: String,
    kind: db::CategoryType,
) -> Result<Category, String> {
    check_category_name(&name)?;
    db::create_category(&pool, &name, kind)
        .await
        .map_err(|e| category_error(e, &name))
}

#[tauri::command]
async fn rename_category(
    pool: State<'_, SqlitePool>,
    id: i64,
    name: String,
) -> Result<bool, String> {
    check_category_name(&name)?;
    db::rename_category(&pool, id, &name)
        .await
        .map_err(|e| category_error(e, &name))
}

fn check_category_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Category name can't be empty".into());
    }
    Ok(())
}

/// A duplicate name gets a readable message; anything else is passed through.
fn category_error(e: sqlx::Error, name: &str) -> String {
    if e.as_database_error()
        .is_some_and(|d| d.is_unique_violation())
    {
        format!("Category '{}' already exists", name.trim())
    } else {
        e.to_string()
    }
}

#[tauri::command]
async fn delete_category(pool: State<'_, SqlitePool>, id: i64) -> Result<bool, String> {
    db::delete_category(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_merchants(pool: State<'_, SqlitePool>) -> Result<Vec<Merchant>, String> {
    db::list_merchants(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_uncategorized_merchant_count(pool: State<'_, SqlitePool>) -> Result<i64, String> {
    db::count_uncategorized_merchants(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_merchant_category(
    pool: State<'_, SqlitePool>,
    merchant_id: i64,
    category_id: i64,
) -> Result<u64, String> {
    db::set_merchant_category(&pool, merchant_id, category_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_transaction_category(
    pool: State<'_, SqlitePool>,
    id: i64,
    category_id: Option<i64>,
) -> Result<bool, String> {
    db::set_transaction_category(&pool, id, category_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_monthly_category_totals(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<MonthlyCategoryTotal>, String> {
    db::monthly_category_totals(&pool)
        .await
        .map_err(|e| e.to_string())
}

/// `month` is "YYYY-MM".
#[tauri::command]
async fn get_month_transactions(
    pool: State<'_, SqlitePool>,
    month: String,
) -> Result<Vec<TransactionView>, String> {
    db::list_month_transactions(&pool, &month)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // e.g. ~/Library/Application Support/com.cuongta.budget-app/budget.db on macOS
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let pool = tauri::async_runtime::block_on(db::open(&dir.join("budget.db")))?;
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            import_csv,
            reset_data,
            get_transactions,
            get_paginate_transactions,
            delete_transaction,
            get_categories,
            create_category,
            rename_category,
            delete_category,
            get_merchants,
            get_uncategorized_merchant_count,
            set_merchant_category,
            set_transaction_category,
            get_monthly_category_totals,
            get_month_transactions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checking_export_skips_summary_block() {
        let text = "\u{feff}Description,,Summary Amt.\n\
            Beginning balance as of 09/01/2026,,\"1,000.00\"\n\
            Total credits,,\"2,500.00\"\n\
            \n\
            Date,Description,Amount,Running Bal.\n\
            09/01/2026,Beginning balance as of 09/01/2026,,\"1,000.00\"\n\
            09/02/2026,\"PAYROLL, ACME INC\",\"2,500.00\",\"3,500.00\"\n\
            09/03/2026,COFFEE SHOP,-4.75,\"3,495.25\"\n";

        let rows = parse_csv(text, "stmt.csv").unwrap();
        assert_eq!(
            rows,
            vec![
                Transaction {
                    unique_transaction_key: "2026-09-02-2500-3500".into(),
                    date: "2026-09-02".into(),
                    description: "PAYROLL, ACME INC".into(),
                    amount: 2500.0,
                    running_balance: 3500.0,
                    source: "stmt.csv".into(),
                },
                Transaction {
                    unique_transaction_key: "2026-09-03--4.75-3495.25".into(),
                    date: "2026-09-03".into(),
                    description: "COFFEE SHOP".into(),
                    amount: -4.75,
                    running_balance: 3495.25,
                    source: "stmt.csv".into(),
                },
            ]
        );
    }

    #[test]
    fn rejects_bad_date_and_missing_header() {
        assert!(parse_csv("Date,Description,Amount\n2026-09-05,X,1.00\n", "x").is_err());
        assert!(parse_csv("foo,bar\n1,2\n", "x").is_err());
    }
}
