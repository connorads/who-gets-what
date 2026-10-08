"""DWP caseloads and mean awards from Stat-Xplore, by area and by country.

For each database: the national series by country finds the latest period,
then one query per level fetches every area at that period. The six benefits
behind the claimant metrics also get four earlier quarterly snapshots, a year
of history, and Carer's Allowance and Universal Credit are also counted at
ages 16 to 64 only. The benefits behind the change decomposition also get one comparison month about
three years before the latest. Queries run sequentially (see `statxplore`).
"""

from __future__ import annotations

import sys

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged
from wgw_pipeline.sources import population, statxplore

HISTORY = ("state_pension", "pension_credit", "attendance_allowance", "pip", "uc_people", "carers_allowance")
HISTORY_STEPS = 4
# Claimants aged 16 to 64, for rates per person aged 16 to 64: database key ->
# (age field, single-age codes, benefit key, benefit code). Unknown ages are
# left out. Carer's Allowance code 17 is "Under 18" (the minimum age is 16);
# Universal Credit codes start at 16.
AGED_16_64 = {
    "carers_allowance": ("CNAGE", [str(a) for a in range(17, 65)], "carers_allowance_16_64", "CA_16_64"),
    "uc_people": ("AGE_CODE", [str(a) for a in range(16, 65)], "uc_people_16_64", "UC_16_64"),
}
# Databases with a mean award, for the change decomposition: one comparison
# month this many years before the latest.
DECOMPOSITION = (
    "state_pension",
    "pension_credit",
    "attendance_allowance",
    "pip",
    "dla",
    "carers_allowance",
    "uc_households",
    "housing_benefit",
    "esa",
    "jsa",
)
COMPARISON_YEARS = 3
# PIP claimants by main disabling condition: the field and its top-level
# valueset, "Disability Category" (about 20 condition groups).
PIP_CONDITIONS = ("DISABILITY_CODE", "str:valueset:PIP_Monthly_new:V_F_PIP_MONTHLY:DISABILITY_CODE:C_PIP_DIS_CAT")


def _codes(cache: RawCache) -> dict[str, list[str]]:
    """GB area codes per level, in the order the queries list them."""
    hexes = pd.read_parquet(staged("hexes"))
    pcon = hexes[(hexes.level == "constituency") & ~hexes.code.str.startswith("N")].code.tolist()
    la_rows = population.fetch_nomis(cache, "NM_2002_1", population.LA_PARAMS)
    la = [c for c in dict.fromkeys(la_rows.GEOGRAPHY_CODE) if not c.startswith("N")]
    return {"constituency": pcon, "local-authority": la}


def _month(period_code: str) -> str:
    return f"{period_code[:4]}-{period_code[4:6]}"


def _ingest_pip_conditions(
    sx: statxplore.StatXplore, benefit: statxplore.Benefit, latest: str, codes: dict[str, list[str]]
) -> None:
    """PIP claimants by main disabling condition group at the latest month, for
    every area and for each country."""
    field, valueset = PIP_CONDITIONS
    frames = [
        sx.by_area_category(benefit, latest, lvl, c, field, valueset).assign(level=lvl) for lvl, c in codes.items()
    ]
    for name, df in (
        ("pip_conditions_area", pd.concat(frames, ignore_index=True)),
        ("pip_conditions_country", sx.by_country_category(benefit, latest, field, valueset)),
    ):
        df = df[df.geo_code != "TOTAL"].rename(columns={"geo_code": "code", "geo_label": "name"})
        df.assign(month=df.period_code.map(_month)).drop(columns="period_code").to_parquet(staged(name), index=False)


def ingest(cache: RawCache) -> None:
    sx = statxplore.StatXplore(cache)
    codes = _codes(cache)
    national, areas = [], []
    for key, benefit in statxplore.BENEFITS.items():
        series = sx.national_series(benefit)
        national.append(series)
        latest = statxplore.latest_period(series)
        periods = statxplore.history_periods(series, benefit.freq, HISTORY_STEPS) if key in HISTORY else [latest]
        comparison = [statxplore.comparison_period(series, COMPARISON_YEARS)] if key in DECOMPOSITION else []
        for level, level_codes in codes.items():
            for period in periods + comparison:
                df = sx.by_area(benefit, period, level, level_codes)
                areas.append(df.assign(level=level))
            if key in AGED_16_64:
                field, ages, age_key, age_code = AGED_16_64[key]
                for months in (periods, comparison):
                    if months:
                        df = sx.by_area_age(benefit, months, level, level_codes, field, ages)
                        areas.append(df.assign(level=level, benefit=age_key, benefit_code=age_code))
        if key == "pip":
            _ingest_pip_conditions(sx, benefit, latest, codes)
        print(f"  stat-xplore {key}: latest {latest}, {sx.requests_made} uncached requests so far", file=sys.stderr)

    nat = pd.concat(national, ignore_index=True)
    nat["month"] = nat.period_code.map(_month)
    nat.to_parquet(staged("statxplore_national"), index=False)

    area = pd.concat(areas, ignore_index=True)
    area = area[area.geo_code != "TOTAL"]
    area["month"] = area.period_code.map(_month)
    area = area.rename(columns={"geo_code": "code", "geo_label": "name"})
    area[
        ["level", "code", "name", "benefit", "benefit_code", "database", "month", "caseload", "mean_weekly_gbp"]
    ].to_parquet(staged("statxplore_area"), index=False)
