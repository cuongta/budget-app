// Thin client over the Rust commands in src-tauri/src/lib.rs; no SQL lives here.
import { invoke } from "@tauri-apps/api/core";

export function getTransactions() {
  return invoke("get_transactions");
}

// page is 1-based. Resolves to { items, page, page_size, total }.
export function getPaginateTransactions(page, pageSize) {
  return invoke("get_paginate_transactions", { page, pageSize });
}

// Resolves to [{ month: "YYYY-MM", category_id, category, kind, total }], oldest first.
// total keeps the bank's sign (spending negative); kind is null for "Uncategorized".
export function getMonthlyCategoryTotals() {
  return invoke("get_monthly_category_totals");
}

// month is "YYYY-MM". Resolves to [{ id, date, description, amount, running_balance,
// merchant_id, merchant, category_id, category, kind, category_overridden }], newest first.
export function getMonthTransactions(month) {
  return invoke("get_month_transactions", { month });
}

// Rust reads and parses the CSV at `path` and inserts its rows. Resolves to
// [inserted, total]: rows already imported are skipped, so inserted <= total.
export function importCsv(path) {
  return invoke("import_csv", { path });
}

// Deletes all transactions; with includeMerchants, merchants and their categories
// too. Resolves to { transactions, merchants } (rows deleted).
export function resetData(includeMerchants) {
  return invoke("reset_data", { includeMerchants });
}

// Resolves to true if a row was deleted.
export function deleteTransaction(id) {
  return invoke("delete_transaction", { id });
}

// Category kinds, in display order; matches CategoryType in src-tauri/src/db.rs.
export const KINDS = ["Expense", "Income", "Transfer", "Investment"];

// Resolves to [{ id, name, kind }]; kind is one of KINDS.
export function getCategories() {
  return invoke("get_categories");
}

// Resolves to the new { id, name, kind }. Rejects with a message if the name is empty or taken.
export function createCategory(name, kind) {
  return invoke("create_category", { name, kind });
}

// Resolves to false if the category doesn't exist. Rejects if the name is empty or taken.
export function renameCategory(id, name) {
  return invoke("rename_category", { id, name });
}

// Its merchants and transactions become uncategorized. Resolves to false if it didn't exist.
export function deleteCategory(id) {
  return invoke("delete_category", { id });
}

// Resolves to [{ id, key, category_id, source, transaction_count }], busiest first.
export function getMerchants() {
  return invoke("get_merchants");
}

// Resolves to how many merchants with transactions have no category yet.
export function getUncategorizedMerchantCount() {
  return invoke("get_uncategorized_merchant_count");
}

// Categorizes every transaction of the merchant (except per-transaction overrides).
// Resolves to the number of transactions updated.
export function setMerchantCategory(merchantId, categoryId) {
  return invoke("set_merchant_category", { merchantId, categoryId });
}

// categoryId = null removes the override and restores the merchant's category.
export function setTransactionCategory(id, categoryId) {
  return invoke("set_transaction_category", { id, categoryId });
}
