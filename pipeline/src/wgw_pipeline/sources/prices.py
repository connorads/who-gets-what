"""Price indices for real-terms conversion.

- HM Treasury GDP deflator at market prices (Quarterly National Accounts,
  September 2026), financial years; the forecast years carry only the OBR's
  annual percentage change, which extends the index.
- ONS CPI index D7BT (2015 = 100), monthly, averaged to financial years.
"""

from __future__ import annotations

import csv
import io
import re
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged
from wgw_pipeline.sheets import Workbook, number

SOURCE = "prices"
GDP_DEFLATOR = "https://assets.publishing.service.gov.uk/media/6abe277f26660e5f62a7f1e9/GDP_Deflators_Qtrly_National_Accounts_September_2026.xlsx"
CPI_D7BT = "https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/d7bt/mm23"

FY = re.compile(r"^(\d{4})-(\d{2})")
MONTHS = {
    m: i for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)
}


def gdp_deflator(cache: RawCache) -> pd.DataFrame:
    book = Workbook(cache.fetch(SOURCE, GDP_DEFLATOR, ext="xlsx").path)
    rows = book.rows(book.sheet_names[0])
    out: list[dict[str, object]] = []
    index = None
    for r in rows:
        label = str(r[0] or "").strip()
        m = FY.match(label)
        if not m:
            continue
        fy = f"{m.group(1)}-{m.group(2)}"
        level, change = number(r[1]), number(r[2])
        forecast = "(1)" in label or level is None
        if level is not None:
            index = level
        elif change is not None and index is not None:
            index = index * (1 + change / 100)
        else:
            continue
        out.append({"fiscal_year": fy, "gdp_deflator": index, "gdp_status": "forecast" if forecast else "outturn"})
    return pd.DataFrame(out)


def cpi(cache: RawCache) -> pd.DataFrame:
    raw = cache.fetch(SOURCE, CPI_D7BT, ext="csv")
    rows = []
    for r in csv.reader(io.StringIO(raw.read_bytes().decode("utf-8-sig"))):
        if len(r) == 2 and len(r[0]) == 8 and r[0][5:] in MONTHS:
            year, month = int(r[0][:4]), MONTHS[r[0][5:]]
            start = year if month >= 4 else year - 1
            rows.append((f"{start}-{(start + 1) % 100:02d}", float(r[1])))
    df = pd.DataFrame(rows, columns=["fiscal_year", "cpi"])
    return df.groupby("fiscal_year").agg(cpi=("cpi", "mean"), cpi_months=("cpi", "size")).reset_index()


def ingest(cache: RawCache) -> None:
    prices = gdp_deflator(cache).merge(cpi(cache), on="fiscal_year", how="left")
    prices.to_parquet(staged("prices"), index=False)
    print(f"  prices: {prices.fiscal_year.min()} to {prices.fiscal_year.max()}", file=sys.stderr)
