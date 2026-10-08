"""Scottish values for devolved benefit families.

Once a benefit is devolved, the DWP area tables leave Scotland out. Scottish
spending in the family then has up to two parts, which cover different people
and never the same claim:

1. Social Security Scotland payments of the replacement benefit (ADP, CDP,
   PADP, CSP, PAWHP). ADP and CDP publish payments by council and fiscal year;
   PADP, CSP and the 2024-25 winter payment are modelled from Scotland totals or
   caseloads and spread over councils by their published council shares.
2. Payments DWP still made in Scotland on the Scottish Government's behalf
   while cases transferred (agency agreements). Modelled: the Stat-Xplore
   Scotland run rate (caseload x mean weekly award x 52, averaged over the
   year's published months), scaled by the ratio of DWP outturn to the same run
   rate in England and Wales that year, and spread over councils by their share
   of Scottish spending in the last year before devolution.

Every SSS-derived value carries the harmonised flag and every estimate the
modelled flag. Council values reach constituencies by census population share
and carry the apportioned flag. Caseloads use Social Security Scotland figures
only: DWP's residual Scottish cases for a devolved benefit are never added.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.areas import norm_name
from wgw_pipeline.canonical.periods import fiscal_year
from wgw_pipeline.paths import staged

AGENCY = {"AA": "attendance_allowance", "PIP": "pip", "DLA": "dla", "CA": "carers_allowance"}
# Last fiscal year of complete DWP Scottish spending, used as the council distribution key.
KEY_YEAR = {"AA": "2019-20", "PIP": "2019-20", "DLA": "2019-20", "CA": "2017-18", "SDA": "2019-20"}
FIRST_DEVOLVED = {"AA": 2020, "PIP": 2020, "DLA": 2020, "SDA": 2020, "CA": 2019, "WFP": 2024}
# Carer's Allowance weekly rate, used to cost Carer Support Payment caseloads.
CA_WEEKLY_RATE = {"2023-24": 76.75, "2024-25": 81.90, "2025-26": 83.30}
COUNTRIES = {"E92000001": "england", "W92000004": "wales", "S92000003": "scotland"}
SOURCE_MODEL = "wgw-scotland-model"
SOURCE_SSS = {"ADP": "sss-adp", "CDP": "sss-cdp", "PADP": "sss-padp", "CSP": "sss-csp", "PAWHP": "sss-pawhp"}


def _fy_of_month(month: str) -> str:
    year, m = int(month[:4]), int(month[5:7])
    return fiscal_year(year if m >= 4 else year - 1)


def council_codes(areas: pd.DataFrame) -> dict[str, str]:
    councils = areas[(areas.level == "local-authority") & (areas.nation == "scotland")]
    return {norm_name(n): c for n, c in zip(councils.name, councils.code, strict=True)}


def _with_codes(df: pd.DataFrame, codes: dict[str, str]) -> pd.DataFrame:
    out = df.copy()
    out["code"] = out.council_name.map(lambda n: codes.get(norm_name(n)))
    unmatched = set(out[out.code.isna()].council_name) - {"Other", "Unknown"}
    assert not unmatched, f"Social Security Scotland councils not matched: {unmatched}"
    return out[out.code.notna()]


def run_rates() -> pd.DataFrame:
    """Annual run rate by country and fiscal year for each agency benefit."""
    nat = pd.read_parquet(staged("statxplore_national"))
    nat = nat[nat.benefit.isin(AGENCY.values()) & nat.geo_code.isin(COUNTRIES)].copy()
    nat["nation"] = nat.geo_code.map(COUNTRIES)
    nat["fiscal_year"] = nat.month.map(_fy_of_month)
    nat["run_rate"] = nat.caseload * nat.mean_weekly_gbp.fillna(0) * 52
    code = {v: k for k, v in AGENCY.items()}
    nat["benefit_code"] = nat.benefit.map(code)
    return nat.groupby(["benefit_code", "nation", "fiscal_year"], as_index=False).run_rate.mean()


def agency_model(measured: pd.DataFrame, last_fy: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Council estimates of DWP agency payments, and the model's checks against outturn."""
    la = measured[measured.level == "local-authority"]
    nation = la.code.str[0].map({"E": "england", "W": "wales", "S": "scotland"})
    by_nation = la.assign(nation=nation).groupby(["benefit_code", "nation", "fiscal_year"]).value_gbp.sum()
    rr = run_rates().set_index(["benefit_code", "nation", "fiscal_year"]).run_rate
    rows, checks = [], []
    for code in AGENCY:
        key = la[(la.benefit_code == code) & (la.fiscal_year == KEY_YEAR[code]) & la.code.str.startswith("S")]
        share = key.set_index("code").value_gbp / key.value_gbp.sum()
        years = sorted({fy for (c, _, fy) in rr.index if c == code})
        for fy in years:
            if fy > last_fy:
                continue
            ew_outturn = by_nation.get((code, "england", fy), np.nan) + by_nation.get((code, "wales", fy), np.nan)
            ew_rate = rr.get((code, "england", fy), np.nan) + rr.get((code, "wales", fy), np.nan)
            factor = ew_outturn / ew_rate
            scot = rr.get((code, "scotland", fy), np.nan) * factor
            checks.append(
                {
                    "benefit_code": code,
                    "fiscal_year": fy,
                    "factor": factor,
                    "wales_predicted": rr.get((code, "wales", fy), np.nan) * factor,
                    "wales_outturn": by_nation.get((code, "wales", fy), np.nan),
                    "scotland_predicted": scot,
                    "scotland_outturn": by_nation.get((code, "scotland", fy), np.nan),
                }
            )
            if int(fy[:4]) < FIRST_DEVOLVED[code] or not np.isfinite(scot):
                continue
            for council, s in share.items():
                rows.append({"code": council, "fiscal_year": fy, "benefit_code": code, "value_gbp": scot * s})
    # Severe Disablement Allowance has no Stat-Xplore run rate: scale Scotland's
    # last DWP year by the England and Wales trend.
    sda = la[la.benefit_code == "SDA"]
    sda_ew = sda[~sda.code.str.startswith("S")].groupby("fiscal_year").value_gbp.sum()
    key = sda[(sda.fiscal_year == KEY_YEAR["SDA"]) & sda.code.str.startswith("S")].set_index("code").value_gbp
    for fy, ew in sda_ew.items():
        if int(fy[:4]) >= FIRST_DEVOLVED["SDA"] and fy <= last_fy:
            for council, v in key.items():
                rows.append(
                    {
                        "code": council,
                        "fiscal_year": fy,
                        "benefit_code": "SDA",
                        "value_gbp": v * ew / sda_ew[KEY_YEAR["SDA"]],
                    }
                )
    agency = pd.DataFrame(rows)
    agency["flags"] = flags.MODELLED
    agency["method"] = "modelled"
    agency["source"] = SOURCE_MODEL
    return agency, pd.DataFrame(checks)


def sss_spend(measured: pd.DataFrame, areas: pd.DataFrame, last_fy: str) -> pd.DataFrame:
    """Council spending on Social Security Scotland replacement benefits, to `last_fy`."""
    codes = council_codes(areas)
    out = []

    fy = _with_codes(pd.read_parquet(staged("sss_payments_council_fy")), codes)
    fy = fy[(fy.fiscal_year <= last_fy) & fy.value_gbp.notna()]
    out.append(
        fy.assign(flags=flags.HARMONISED, method="measured")[
            ["code", "fiscal_year", "benefit_code", "value_gbp", "flags", "method"]
        ]
    )

    monthly = pd.read_parquet(staged("sss_payments_scotland_month"))
    monthly["fiscal_year"] = monthly.month.map(_fy_of_month)
    padp_fy = monthly[monthly.benefit_code == "PADP"].groupby("fiscal_year").value_gbp.sum()
    alltime = _with_codes(pd.read_parquet(staged("sss_padp_payments_council_alltime")), codes)
    padp_share = alltime.set_index("code").value_gbp / alltime.value_gbp.sum()
    for year, total in padp_fy.items():
        if year <= last_fy:
            out.append(_spread(padp_share, total, year, "PADP"))

    csp = pd.read_parquet(staged("sss_csp_caseload_month"))
    csp["fiscal_year"] = csp.month.map(_fy_of_month)
    csp["value_gbp"] = csp.in_payment * csp.fiscal_year.map(CA_WEEKLY_RATE) * 52 / 12
    csp_caseload = _with_codes(pd.read_parquet(staged("sss_caseload_council")).query("benefit_code == 'CSP'"), codes)
    csp_share = csp_caseload.set_index("code").caseload / csp_caseload.caseload.sum()
    for year, total in csp.groupby("fiscal_year").value_gbp.sum().items():
        if year <= last_fy:
            out.append(_spread(csp_share, total, year, "CSP"))

    # Winter 2024/25: Pension Age Winter Heating Payment went to the same group as
    # the means-tested Winter Fuel Payment in England and Wales, so each council
    # gets its Pension Credit spending times the England and Wales WFP:PC ratio.
    la = measured[(measured.level == "local-authority") & (measured.fiscal_year == "2024-25")]
    ew = la[~la.code.str.startswith("S")].groupby("benefit_code").value_gbp.sum()
    if last_fy >= "2024-25":
        pc = la[(la.benefit_code == "PC") & la.code.str.startswith("S")]
        pawhp = pc.assign(benefit_code="PAWHP", value_gbp=pc.value_gbp * ew["WFP"] / ew["PC"])
        out.append(
            pawhp.assign(flags=flags.HARMONISED | flags.MODELLED, method="modelled")[
                ["code", "fiscal_year", "benefit_code", "value_gbp", "flags", "method"]
            ]
        )

    rows = pd.concat(out, ignore_index=True)
    rows["source"] = rows.benefit_code.map(SOURCE_SSS)
    return rows


def _spread(share: pd.Series, total: float, year: str, code: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "code": share.index,
            "fiscal_year": year,
            "benefit_code": code,
            "value_gbp": share.to_numpy() * total,
            "flags": flags.HARMONISED | flags.MODELLED,
            "method": "modelled",
        }
    )


def to_constituencies(council_rows: pd.DataFrame, weights: pd.DataFrame, value: str) -> pd.DataFrame:
    """Split council rows across constituencies by population share."""
    merged = council_rows.merge(weights, left_on="code", right_on="local_authority")
    merged[value] = merged[value] * merged.weight
    merged["flags"] = merged["flags"] | flags.APPORTIONED
    keys = [c for c in council_rows.columns if c not in ("code", value, "flags")]
    out = merged.groupby(["constituency", *keys], as_index=False, dropna=False).agg(
        **{value: (value, "sum"), "flags": ("flags", lambda s: int(np.bitwise_or.reduce(s.to_numpy())))}
    )
    return out.rename(columns={"constituency": "code"})
