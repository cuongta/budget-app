use serde::Serialize;

/// One row ready for the `transactions` table.
#[derive(Debug, PartialEq, Serialize)]
pub struct Transaction {
    pub unique_transaction_key: String,
    pub date: String,
    pub description: String,
    pub amount: f64,
    pub running_balance: f64,
    pub source: String,
}

/// "-1,234.56" -> -1234.56; empty -> None.
pub fn parse_amount(s: &str) -> Option<f64> {
    let s = s.trim().replace(',', "");
    if s.is_empty() {
        None
    } else {
        s.parse().ok()
    }
}

/// "MM/DD/YYYY" -> "YYYY-MM-DD", so dates sort correctly as text.
pub fn parse_date(s: &str) -> Option<String> {
    let mut parts = s.trim().split('/');
    let m: u32 = parts.next()?.parse().ok()?;
    let d: u32 = parts.next()?.parse().ok()?;
    let y: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// Parses a Bank of America CSV export (checking/savings or credit card).
pub fn parse_csv(text: &str, source: &str) -> Result<Vec<Transaction>, String> {
    let text = text.trim_start_matches('\u{feff}');

    // Checking/savings exports start with a summary block; skip to the real header.
    let start = std::iter::once(0)
        .chain(text.match_indices('\n').map(|(i, _)| i + 1))
        .find(|&i| text[i..].starts_with("Date,") || text[i..].starts_with("Posted Date,"))
        .ok_or("no transaction header (Date or Posted Date) found")?;

    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(text[start..].as_bytes());
    let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
    let col = |name: &str| headers.iter().position(|h| h.trim() == name);

    let date_col = col("Date")
        .or_else(|| col("Posted Date"))
        .ok_or("missing date column")?;
    let desc_col = col("Description")
        .or_else(|| col("Payee"))
        .ok_or("missing description column")?;
    let amount_col = col("Amount").ok_or("missing amount column")?;
    let balance_col = col("Running Bal.").ok_or("missing running balance")?;

    let mut out = Vec::new();
    for (i, record) in rdr.records().enumerate() {
        let record = record.map_err(|e| e.to_string())?;
        let get = |c: usize| record.get(c).unwrap_or("").trim();
        if get(desc_col).contains("Beginning balance") {
            continue;
        }
        let amount = parse_amount(get(amount_col))
            .ok_or_else(|| format!("line {}: bad date {:?}", i + 2, get(date_col)))?;
        let date: String = parse_date(get(date_col))
            .ok_or_else(|| format!("line {}: bad date {:?}", i + 2, get(date_col)))?;
        let running_balance = parse_amount(get(balance_col)).ok_or_else(|| format!(""))?;
        let unique_transaction_key = format!("{}-{}-{}", date, amount, running_balance);
        out.push(Transaction {
            unique_transaction_key,
            date,
            description: get(desc_col).to_string(),
            amount,
            running_balance,
            source: source.to_string(),
        });
    }
    Ok(out)
}
