"""DWP benefit expenditure outturn and forecast tables, Spring Forecast 2026.

Table 1a (nominal £ million, GB benefit by benefit) is the national control
total that area spending is checked against.
"""

from __future__ import annotations

import re
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged
from wgw_pipeline.sheets import Workbook, number

SOURCE = "dwp-outturn"
URL = "https://assets.publishing.service.gov.uk/media/69dcdc56d3e08b8871b66628/outturn-and-forecast-tables-spring-forecast-2026.ods"
YEAR = re.compile(r"^(\d{4})/(\d{2})")


def parse_table_1a(rows: list[list[object]]) -> pd.DataFrame:
    years = {
        j: f"{m.group(1)}-{m.group(2)}" for j, v in enumerate(rows[1]) if j >= 3 and (m := YEAR.match(str(v or "")))
    }
    status = {j: str(rows[2][j] or "").strip() for j in years}
    out, parent = [], None
    for r in rows[3:]:
        label = str(r[1] or "").strip()
        if not label or label.startswith("*"):
            continue
        sub = label.lower().startswith("of which")
        if not sub:
            parent = label
        for j, fy in years.items():
            v = number(r[j]) if j < len(r) else None
            if v is not None:
                out.append(
                    {
                        "line_item": f"{parent} - {label}" if sub else label,
                        "fiscal_year": fy,
                        "status": status[j].lower(),
                        "spend_gbp_m": v,
                    }
                )
    return pd.DataFrame(out)


def ingest(cache: RawCache) -> None:
    book = Workbook(cache.fetch(SOURCE, URL, ext="ods").path)
    table = parse_table_1a(book.rows("Table_1a"))
    table.to_parquet(staged("dwp_outturn"), index=False)
    print(f"  dwp outturn: {table.line_item.nunique()} lines", file=sys.stderr)
