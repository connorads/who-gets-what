"""Income tax by area from the HMRC Survey of Personal Incomes.

Values are income tax only: no National Insurance, VAT or council tax. Every
value carries the survey flag. A suppressed cell stays null with the
suppressed flag; nothing is derived from neighbouring cells or totals.
"""

from __future__ import annotations

import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.la_codes import SPI_NAMES, to_lad23
from wgw_pipeline.paths import staged

LA_PREFIXES = ("E06", "E07", "E08", "E09", "W06", "S12")
PCON_PREFIXES = ("E14", "W07", "S14")


def build(areas: pd.DataFrame) -> pd.DataFrame:
    spi = pd.read_parquet(staged("hmrc_spi"))
    la = spi[spi.table == "3.14"].copy()
    la["area_code"] = la.area_code.fillna(la.area_name.map(SPI_NAMES))
    la = la[la.area_code.fillna("").str.startswith(LA_PREFIXES)]
    la = to_lad23(
        la.rename(columns={"area_code": "code", "tax_year": "fiscal_year"}),
        code="code",
        year="fiscal_year",
        values=["tax_total_m", "tax_n_k"],
        keys=[],
    ).assign(level="local-authority", source="hmrc-spi-local-authority")
    pcon = spi[(spi.table == "3.15") & spi.area_code.fillna("").str.startswith(PCON_PREFIXES)]
    pcon = pcon.rename(columns={"area_code": "code", "tax_year": "fiscal_year"})[
        ["code", "fiscal_year", "tax_total_m", "tax_n_k"]
    ].assign(level="constituency", source="hmrc-spi-constituency")
    out = pd.concat([la, pcon], ignore_index=True)
    known = set(zip(areas.level, areas.code, strict=True))
    out = out[[k in known for k in zip(out.level, out.code, strict=True)]].copy()
    out["income_tax_gbp"] = out.tax_total_m * 1e6
    out["taxpayers"] = out.tax_n_k * 1000
    out["flags"] = flags.SURVEY | out.income_tax_gbp.isna().map({True: flags.SUPPRESSED, False: 0})
    return out[["level", "code", "fiscal_year", "income_tax_gbp", "taxpayers", "flags", "source"]]
