"""DWP area spending as measured: one row per area, fiscal year and benefit.

Rules from the research ingest spec:

- The published TOTAL is never used; totals are rebuilt from family members.
- Constituency rows are 2024 boundaries only (`PCON2024`); 2010-boundary rows
  are never read, so the two sets cannot be summed or name-joined.
- Local authority rows are re-keyed to April 2023 councils (`la_codes`).
- Scottish rows for a devolved benefit are absent (the source shows 0); the
  Scotland module supplies them.
- Orkney and Shetland State Pension is understated in 2023-24 and 2024-25
  (Shetland claimants coded "Unknown" from August 2023 to August 2024): flagged
  partial coverage.
- Area Winter Fuel Payment in 2022-23 and 2023-24 includes the pensioner Cost
  of Living top-up: flagged as a series break.
- Scottish Carer's Allowance in 2018-19 covers April to 2 September only, before
  devolution: flagged partial coverage.
"""

from __future__ import annotations

import duckdb
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.benefits import BY_CODE
from wgw_pipeline.canonical.la_codes import to_lad23
from wgw_pipeline.paths import staged

FIRST_FY = "2010-11"
ORKNEY_SHETLAND = {"S12000023", "S12000027", "S14000051"}
SOURCE_LA = "dwp-benefit-expenditure-local-authority"
SOURCE_PCON = "dwp-benefit-expenditure-constituency"


def measured(areas: pd.DataFrame) -> pd.DataFrame:
    con = duckdb.connect()
    la_raw = con.execute(
        f"""
        select gss as code, fiscal_year, benefit_code, spend_gbp_m
        from '{staged("dwp_spend_la")}'
        where area_level = 'la' and benefit_code <> 'TOTAL' and spend_gbp_m is not null
          and fiscal_year >= '{FIRST_FY}' and gss not like 'N%'
        """
    ).df()
    la = to_lad23(la_raw, code="code", year="fiscal_year", values=["spend_gbp_m"], keys=["benefit_code"])
    la = la.assign(level="local-authority", source=SOURCE_LA)
    pcon = con.execute(
        f"""
        select gss as code, fiscal_year, benefit_code, spend_gbp_m
        from '{staged("dwp_spend_pcon")}'
        where boundary = 'PCON2024' and area_level = 'pcon' and benefit_code <> 'TOTAL'
          and spend_gbp_m is not null and gss not like 'N%'
        """
    ).df()
    pcon = pcon.assign(level="constituency", source=SOURCE_PCON)
    rows = pd.concat([la, pcon], ignore_index=True)
    known = set(zip(areas.level, areas.code, strict=True))
    rows = rows[[k in known for k in zip(rows.level, rows.code, strict=True)]].copy()
    rows["value_gbp"] = rows.spend_gbp_m * 1e6
    rows["flags"] = 0
    rows.loc[
        rows.code.isin(ORKNEY_SHETLAND) & (rows.benefit_code == "SP") & rows.fiscal_year.isin(["2023-24", "2024-25"]),
        "flags",
    ] |= flags.PARTIAL_COVERAGE
    rows.loc[(rows.benefit_code == "WFP") & rows.fiscal_year.isin(["2022-23", "2023-24"]), "flags"] |= (
        flags.SERIES_BREAK
    )
    rows.loc[
        rows.code.str.startswith("S") & (rows.benefit_code == "CA") & (rows.fiscal_year == "2018-19"), "flags"
    ] |= flags.PARTIAL_COVERAGE
    rows["method"] = "measured"
    rows["family"] = rows.benefit_code.map(lambda c: BY_CODE[c].family if c in BY_CODE else None)
    unknown = set(rows.benefit_code) - set(BY_CODE)
    assert not unknown, f"benefit codes without a definition: {unknown}"
    return rows[["level", "code", "fiscal_year", "benefit_code", "family", "value_gbp", "flags", "method", "source"]]
