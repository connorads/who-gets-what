"""Social Security Scotland statistics: the Scottish replacements for devolved DWP benefits.

| Code  | Benefit                               | Replaces | Tables used                                   |
| ADP   | Adult Disability Payment              | PIP      | payments by council and FY, caseload by council |
| CDP   | Child Disability Payment              | DLA      | payments by council and FY, caseload by council |
| PADP  | Pension Age Disability Payment        | AA       | payments by month, all-time payments and caseload by council |
| CSP   | Carer Support Payment                 | CA       | caseload by month, by council and by age      |
| PAWHP | Pension Age Winter Heating Payment    | WFP      | recipients and expenditure by council, winter 2025/26 |

Councils are published by name; `council_code` resolves them against the April
2023 council list. "Other" and "Unknown" rows (unmatched postcodes) are kept
with no code, so Scotland totals still reconcile.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged
from wgw_pipeline.sheets import Workbook, number

SOURCE = "sss"
B = "https://www.socialsecurity.gov.scot/binaries/socialsecurity/publications"
URLS = {
    "ADP": f"{B}/2026/09/adult-disability-payment-statistics-to-31-july-2026/adult-disability-payment-statistics-to-31-july-2026/publishing%3AcontentBlocks%5B3%5D/publishing%3Adocument/Adult+Disability+Payment+-+to+31+July+2026+-+Tables.xlsx",
    "PADP": f"{B}/2026/09/pension-age-disability-payment-and-scottish-adult-disability-living-allowance-statistics-to-31-july-2026/pension-age-disability-payment-and-scottish-adult-disability-living-allowance-statistics-to-31-july-2026/publishing%3AcontentBlocks%5B3%5D/publishing%3Adocument/Pension+Age+Disability+Payment+-+to+31+July+2026+-+Tables.xlsx",
    "CSP": f"{B}/2026/08/carer-support-payment-statistics-and-carers-allowance-supplement-statistics-to-30-june-2026/carer-support-payment-statistics-and-carers-allowance-supplement-statistics-to-30-june-2026/publishing%3AcontentBlocks%5B3%5D/publishing%3Adocument/Carer+Support+Payment+and+Carer%27s+Allowance+Supplement+June+2026+Tables.xlsx",
    "CDP": f"{B}/2026/08/child-disability-payment-statistics-to-30-june-2026/child-disability-payment-statistics-to-30-june-2026/publishing%3AcontentBlocks%5B2%5D/publishing%3Adocument/Child+Disability+Payment+Statistics+to+30+June+2026.xlsx",
    "PAWHP": f"{B}/2026/05/winter-heating-benefits-statistics-for-winter-2025-2026/winter-heating-benefits-statistics-for-winter-2025-2026/publishing%3AcontentBlocks%5B4%5D/publishing%3Adocument/Pension+Age+Winter+Heating+Payment+Tables+March+2026.xlsx",
}  # fmt: skip

MONTH = re.compile(r"(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})")
FY_LABEL = re.compile(r"Financial Year (\d{4})\D+(\d{2})", re.IGNORECASE)


def month_code(text: str) -> str | None:
    m = MONTH.search(text)
    return datetime.strptime(f"{m.group(1)} {m.group(2)}", "%B %Y").strftime("%Y-%m") if m else None


def _table(rows: list[list[object]], first_header: str) -> tuple[list[str], list[list[object]]]:
    """Header and body rows of the table whose header row starts with `first_header`."""
    start = next(
        i for i, r in enumerate(rows) if r and str(r[0] or "").strip().lower().startswith(first_header.lower())
    )
    header = [str(c or "").strip() for c in rows[start]]
    body = []
    for r in rows[start + 1 :]:
        first = r[0]
        if first is None or str(first).startswith("[note"):
            break
        body.append(r)
    return header, body


def _title(rows: list[list[object]]) -> str:
    return str(rows[0][0])


def _council_rows(body: list[list[object]], value_col: int) -> list[tuple[str, float | None]]:
    return [(str(r[0]).strip(), number(r[value_col])) for r in body if str(r[0]).strip() != "Total"]


def payments_by_council_fy(book: Workbook, sheet: str, code: str) -> pd.DataFrame:
    rows = book.rows(sheet)
    header, body = _table(rows, "Local Authority")
    out = []
    for j, h in enumerate(header):
        m = re.match(r"Value of payments(?: made)? in Financial Year (\d{4})-(\d{2})", h, re.IGNORECASE)
        if not m:
            continue
        fy = f"{m.group(1)}-{m.group(2)}"
        for council, value in _council_rows(body, j):
            out.append({"benefit_code": code, "council_name": council, "fiscal_year": fy, "value_gbp": value})
    return pd.DataFrame(out)


def payments_by_month(book: Workbook, sheet: str, code: str, first_header: str, value_header: str) -> pd.DataFrame:
    header, body = _table(book.rows(sheet), first_header)
    month_col = next(j for j, h in enumerate(header) if h.lower().startswith("month"))
    value_col = next(j for j, h in enumerate(header) if h.lower().startswith(value_header.lower()))
    type_col = 0 if month_col == 1 else None
    out = []
    for r in body:
        if type_col is not None and str(r[type_col]).strip() not in ("All Clients", "All"):
            continue
        month = month_code(str(r[month_col]))
        if month is None or "Financial" in str(r[month_col]):
            continue
        out.append({"benefit_code": code, "month": month, "value_gbp": number(r[value_col])})
    return pd.DataFrame(out)


def caseload_by_council(book: Workbook, sheet: str, code: str) -> pd.DataFrame:
    rows = book.rows(sheet)
    snapshot = month_code(_title(rows))
    _header, body = _table(rows, "Local Authority")
    return pd.DataFrame(
        [
            {"benefit_code": code, "council_name": council, "month": snapshot, "caseload": value}
            for council, value in _council_rows(body, 1)
        ]
    )


def caseload_by_age(book: Workbook, sheet: str, code: str) -> pd.DataFrame:
    """Scotland caseload by age group at the sheet's snapshot month, without the total row."""
    rows = book.rows(sheet)
    snapshot = month_code(_title(rows))
    _header, body = _table(rows, "Client age group")
    return pd.DataFrame(
        [
            {"benefit_code": code, "month": snapshot, "age_group": str(r[0]).strip(), "caseload": number(r[1])}
            for r in body
            if str(r[0]).strip() != "Total"
        ]
    )


def ingest(cache: RawCache) -> None:
    books = {code: Workbook(cache.fetch(SOURCE, url, ext="xlsx").path) for code, url in URLS.items()}
    adp, cdp, padp, csp, pawhp = (books[c] for c in ("ADP", "CDP", "PADP", "CSP", "PAWHP"))

    payments_fy = pd.concat(
        [
            payments_by_council_fy(adp, "T12 Payments by LA", "ADP"),
            payments_by_council_fy(cdp, "T11 Payments by LA", "CDP"),
        ],
        ignore_index=True,
    )
    payments_month = pd.concat(
        [
            payments_by_month(adp, "T11 Payments", "ADP", "Type of client", "Total value of payments"),
            payments_by_month(cdp, "T10 Payments", "CDP", "Type of client", "Total value of payments"),
            payments_by_month(padp, "T9 Payments", "PADP", "Month", "Value of payments"),
        ],
        ignore_index=True,
    )
    header, body = _table(padp.rows("T10 Payments by LA"), "Local authority")
    padp_alltime = pd.DataFrame(
        [{"benefit_code": "PADP", "council_name": c, "value_gbp": v} for c, v in _council_rows(body, 2)]
    )
    caseload = pd.concat(
        [
            caseload_by_council(adp, "T25 Caseload by LA", "ADP"),
            caseload_by_council(cdp, "T24 Caseload by LA", "CDP"),
            caseload_by_council(padp, "T18 Caseload by LA", "PADP"),
            caseload_by_council(csp, "Table 10 Caseload by LA", "CSP"),
        ],
        ignore_index=True,
    )
    header, body = _table(csp.rows("Table 9 Caseload"), "Type of client")
    in_payment = header.index("In Payment")
    csp_monthly = pd.DataFrame(
        [
            {
                "benefit_code": "CSP",
                "month": month_code(str(r[1])),
                "in_payment": number(r[in_payment]),
                "caseload": number(r[2]),
            }
            for r in body
            if str(r[0]).strip() == "All" and month_code(str(r[1]))
        ]
    )
    csp_age = caseload_by_age(csp, "Table 11 Caseload by age", "CSP")
    pawhp_rows = pawhp.rows("Table 3 - Local Authority")
    recipients = _block(pawhp_rows, "Table 3a")
    spend = _block(pawhp_rows, "Table 3c")
    pawhp_la = pd.DataFrame(
        [
            {"council_name": c, "winter": "2025-26", "recipients": recipients.get(c), "value_gbp": v}
            for c, v in spend.items()
            if c != "Total"
        ]
    )

    payments_fy.to_parquet(staged("sss_payments_council_fy"), index=False)
    payments_month.to_parquet(staged("sss_payments_scotland_month"), index=False)
    padp_alltime.to_parquet(staged("sss_padp_payments_council_alltime"), index=False)
    caseload.to_parquet(staged("sss_caseload_council"), index=False)
    csp_monthly.to_parquet(staged("sss_csp_caseload_month"), index=False)
    csp_age.to_parquet(staged("sss_csp_caseload_age"), index=False)
    pawhp_la.to_parquet(staged("sss_pawhp_council"), index=False)
    print(
        f"  sss: {len(payments_fy)} council FY payments, {len(caseload)} council caseloads "
        f"({caseload.groupby('benefit_code').month.first().to_dict()})",
        file=sys.stderr,
    )


def _block(rows: list[list[object]], table: str) -> dict[str, float | None]:
    """Council -> value for one sub-table of the PAWHP local authority sheet."""
    start = next(i for i, r in enumerate(rows) if str(r[0] or "").startswith(f"{table}:"))
    out: dict[str, float | None] = {}
    for r in rows[start + 2 :]:
        if not isinstance(r[0], str) or not r[0].strip() or r[0].startswith(("[", "Table")):
            break
        out[r[0].strip()] = number(r[1])
    return out
