"""Fiscal years and price factors.

`real_gdp` and `real_cpi` multiply a nominal value in a fiscal year into prices
of the price base year, 2026-27, so the base year's factors are exactly 1.
The GDP deflator for 2026-27 is the OBR forecast; CPI for 2026-27 is the
average of the months published so far.
"""

from __future__ import annotations

import pandas as pd

from wgw_pipeline.paths import staged

PRICE_BASE = "2026-27"
FIRST_YEAR = 2010
LAST_OUTTURN = "2025-26"


def fiscal_year(start: int) -> str:
    return f"{start}-{(start + 1) % 100:02d}"


def build_dim_period() -> pd.DataFrame:
    prices = pd.read_parquet(staged("prices")).set_index("fiscal_year")
    years = [fiscal_year(y) for y in range(FIRST_YEAR, int(PRICE_BASE[:4]) + 1)]
    base = prices.loc[PRICE_BASE]
    rows = []
    for fy in years:
        p = prices.loc[fy]
        rows.append(
            {
                "fiscal_year": fy,
                "status": "outturn" if fy <= LAST_OUTTURN else "forecast",
                "gdp_deflator": p.gdp_deflator,
                "cpi": p.cpi,
                "cpi_months": int(p.cpi_months),
                "real_gdp": 1.0 if fy == PRICE_BASE else round(base.gdp_deflator / p.gdp_deflator, 6),
                "real_cpi": 1.0 if fy == PRICE_BASE else round(base.cpi / p.cpi, 6),
            }
        )
    out = pd.DataFrame(rows)
    assert out.notna().all().all(), "a fiscal year lacks a price index"
    return out
