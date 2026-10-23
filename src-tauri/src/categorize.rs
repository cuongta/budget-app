/// Short, stable name for who a transaction is with, e.g. "EXAMPLE CARD SVCS".
///
/// Transactions with the same key share one `merchants` row (and so one category),
/// so everything that changes between payments (reference ids, dates, memos) is
/// dropped.
pub fn merchant_key(description: &str) -> String {
    let desc = description.to_uppercase();

    // ACH: "<COMPANY> DES:<what> ID:<ref> INDN:<name> CO ID:<id> <class>".
    // The company name before " DES:" is the stable part.
    if let Some((company, _)) = desc.split_once(" DES:") {
        return normalize_spaces(company);
    }

    // Everything after a confirmation number or memo separator is per-transaction.
    let mut rest = desc.as_str();
    for cut in [" CONFIRMATION#", " CONF#", ";"] {
        if let Some((before, _)) = rest.split_once(cut) {
            rest = before;
        }
    }
    // Zelle: "ZELLE PAYMENT FROM <NAME> FOR <memo>"; the memo changes, the name doesn't.
    if rest.starts_with("ZELLE ") {
        if let Some((before, _)) = rest.split_once(" FOR ") {
            rest = before;
        }
    }

    // Drop tokens that differ every time: dates ("01/16") and long reference
    // numbers ("1234567890"). Short numbers like an account's last 4 digits stay.
    let kept: Vec<&str> = rest
        .split_whitespace()
        .filter(|token| !is_date(token) && !is_long_reference(token))
        .collect();
    kept.join(" ")
        .trim_matches(|c: char| c == '"' || c == ',')
        .to_string()
}

fn normalize_spaces(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "MM/DD"
fn is_date(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() == 5
        && bytes[2] == b'/'
        && token.chars().filter(|c| c.is_ascii_digit()).count() == 4
}

/// 5+ digits, e.g. a deposit or check reference number.
fn is_long_reference(token: &str) -> bool {
    token.chars().filter(|c| c.is_ascii_digit()).count() >= 5
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ach_uses_company_name_before_des() {
        let cases = [
            (
                "EXAMPLE CARD SVCS DES:AUTOPAY ID:000000000012345 INDN:DOE JANE A CO ID:1111111111 PPD",
                "EXAMPLE CARD SVCS",
            ),
            ("CITYPOWER DES:WEB ONLINE ID:11112222333344 INDN:JANE DOE CO ID:2222222222 WEB", "CITYPOWER"),
            (
                "ACME-CABLE DES:CABLE SVCS ID:1234567 INDN:JANE *DOE CO ID:0000333333 PPD",
                "ACME-CABLE",
            ),
            (
                "Example County TAX DES:ExampleCo ID:4444444444 INDN:Jane Doe CO ID:0000555555 WEB",
                "EXAMPLE COUNTY TAX",
            ),
        ];
        for (description, want) in cases {
            assert_eq!(merchant_key(description), want, "{description}");
        }
    }

    #[test]
    fn same_merchant_gets_same_key_across_payments() {
        // Different ID: and INDN: spelling, same company.
        assert_eq!(
            merchant_key("EXAMPLE CARD SVCS DES:AUTOPAY ID:000000000012345 INDN:DOE JANE CO ID:1111111111 PPD"),
            merchant_key("EXAMPLE CARD SVCS DES:AUTOPAY ID:000000000067890 INDN:DOE JANE A CO ID:1111111111 PPD"),
        );
        assert_eq!(
            merchant_key("BKOFAMERICA MOBILE 01/16 1234567890 DEPOSIT *MOBILE FL"),
            merchant_key("BKOFAMERICA MOBILE 07/09 9876543210 DEPOSIT *MOBILE FL"),
        );
    }

    #[test]
    fn non_ach_formats() {
        let cases = [
            (
                "BKOFAMERICA MOBILE 01/16 1234567890 DEPOSIT *MOBILE FL",
                "BKOFAMERICA MOBILE DEPOSIT *MOBILE FL",
            ),
            (
                "Mobile transfer from CHK 1234 Confirmation# abc12defg; DOE, JOHN",
                "MOBILE TRANSFER FROM CHK 1234",
            ),
            (
                "Online Banking transfer from CHK 5678 Confirmation# 1234567890",
                "ONLINE BANKING TRANSFER FROM CHK 5678",
            ),
            (
                "Online Banking payment to CRD 9012 Confirmation# xyz98wvut",
                "ONLINE BANKING PAYMENT TO CRD 9012",
            ),
            (
                "Zelle payment from ALEX SAMPLE for Bike Repair\"; Conf# a1b2c3d4e\"",
                "ZELLE PAYMENT FROM ALEX SAMPLE",
            ),
            (
                "Zelle payment from SAM EXAMPLE Conf# Z99Y8X7W6",
                "ZELLE PAYMENT FROM SAM EXAMPLE",
            ),
            (
                "Zelle payment from EXAMPLE CO LLC for HOME REPAIR\"; Conf# Q1W2E3R4T\"",
                "ZELLE PAYMENT FROM EXAMPLE CO LLC",
            ),
        ];
        for (description, want) in cases {
            assert_eq!(merchant_key(description), want, "{description}");
        }
    }
}
