"""Caseloads by area and month.

DWP (Stat-Xplore) rows cover every area, except that Scottish areas drop the
residual DWP cases of a devolved benefit (Attendance Allowance, PIP, DLA,
Carer's Allowance): Scotland uses Social Security Scotland caseloads instead,
at each publication's own snapshot month, so no claim is counted twice.
Stat-Xplore perturbs small cells; its counts are used as published.

Carer's Allowance also has a count at ages 16 to 64 (`CA_16_64`) for rates per
person aged 16 to 64. Social Security Scotland publishes Carer Support Payment
by age for Scotland only, so `CSP_16_64` applies Scotland's share aged 16 to
64 to each council's count and is flagged modelled.
"""

from __future__ import annotations

import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.benefits import BY_CODE
from wgw_pipeline.canonical.scotland import _with_codes, council_codes, to_constituencies
from wgw_pipeline.paths import staged

DEVOLVED_DWP = {"AA", "PIP", "DLA", "CA", "CA_16_64"}
AGED_65_PLUS = "65 and over"


def build(areas: pd.DataFrame, weights: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    dwp = pd.read_parquet(staged("statxplore_area"))
    known = set(zip(areas.level, areas.code, strict=True))
    dwp = dwp[[k in known for k in zip(dwp.level, dwp.code, strict=True)]]
    residual = dwp[dwp.code.str.startswith("S") & dwp.benefit_code.isin(DEVOLVED_DWP)]
    dwp = dwp.drop(residual.index)
    dwp = dwp.assign(flags=0, method="measured", source="dwp-stat-xplore")[
        ["level", "code", "month", "benefit_code", "caseload", "mean_weekly_gbp", "flags", "method", "source"]
    ]

    sss = _with_codes(pd.read_parquet(staged("sss_caseload_council")), council_codes(areas))
    sss = sss.assign(
        level="local-authority",
        flags=lambda d: flags.HARMONISED | d.caseload.isna().map({True: flags.SUPPRESSED, False: 0}),
        method="measured",
        source=lambda d: "sss-" + d.benefit_code.str.lower(),
        mean_weekly_gbp=float("nan"),
    )
    csp = sss[sss.benefit_code == "CSP"]
    csp_16_64 = csp.assign(
        benefit_code="CSP_16_64",
        caseload=csp.caseload * csp.month.map(_csp_share_16_64()),
        flags=csp["flags"] | flags.MODELLED,
        method="modelled",
    )
    assert csp_16_64.caseload.notna().sum() == csp.caseload.notna().sum(), "no CSP age split for that month"
    sss = pd.concat([sss, csp_16_64], ignore_index=True)
    seats = to_constituencies(
        sss[["code", "month", "benefit_code", "caseload", "flags", "method", "source", "mean_weekly_gbp"]],
        weights,
        "caseload",
    )
    seats = seats.assign(level="constituency", method="apportioned")
    out = pd.concat([dwp, sss[dwp.columns], seats[dwp.columns]], ignore_index=True)
    out["family"] = out.benefit_code.map(lambda c: BY_CODE[c].family)
    residual = residual[residual.benefit_code != "CA_16_64"]
    residual_by_month = (
        residual[residual.level == "local-authority"].groupby(["benefit_code", "month"], as_index=False).caseload.sum()
    )
    return out, residual_by_month


def _csp_share_16_64() -> dict[str, float]:
    """Scotland's share of Carer Support Payment cases aged 16 to 64, by month.
    The youngest group is under 18; the minimum age is 16."""
    ages = pd.read_parquet(staged("sss_csp_caseload_age"))
    out = {}
    for month, g in ages.groupby("month"):
        total = g.caseload.sum()
        out[month] = float((total - g.loc[g.age_group == AGED_65_PLUS, "caseload"].sum()) / total)
    return out
