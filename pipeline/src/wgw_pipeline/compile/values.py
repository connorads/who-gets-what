"""Metric values for every area, period and denominator, with flags, GB ranks and GB values.

Rules (ADR 0004 and the research ingest spec):

- Totals are sums of family members, never a published total.
- Fiscal-year values divide by the mid-year population at the start of the
  year (FY 2024-25 uses mid-2024). Caseload rates use mid-2024.
- A ratio pairs spending and income tax for the same fiscal year.
- Claimant metrics publish the months within a year of the latest; earlier
  comparison months serve the change decomposition only.
- A period is published for a level only when at least 90% of areas have
  every family the metric sums; an area missing a family that existed that
  year keeps the sum of the rest, flagged partial coverage.
- An area whose denominator band holds fewer than 1,000 people is flagged
  small population. Ranks run over GB and leave out small-population,
  partial-coverage and suppressed values. Rank 1 is the highest value.
- A GB value is the GB numerator over the GB population band, both summed
  over councils, and every level publishes the same one.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.benefits import BY_CODE
from wgw_pipeline.compile.spec import BAND, METRICS, Metric

LEVELS = ("constituency", "local-authority")
CASELOAD_POPULATION_YEAR = 2024
SMALL_POPULATION = 1000
COMPLETE_SHARE = 0.9
SSS_MONTH_TOLERANCE = 4
CLAIMANT_HISTORY_MONTHS = 12
EXCLUDED_FROM_RANK = flags.SMALL_POPULATION | flags.PARTIAL_COVERAGE | flags.SUPPRESSED
GB_LEVEL = "local-authority"


@dataclass(frozen=True)
class Values:
    """`values`: one row per metric, denominator, level, period and area.
    `gb`: GB value per metric, denominator, level and period; equal across levels.
    `coverage`: nations covered per metric and period (all levels agree)."""

    values: pd.DataFrame
    gb: pd.DataFrame
    coverage: pd.DataFrame


def _or(series: pd.Series) -> int:
    return int(np.bitwise_or.reduce(series.to_numpy(dtype=np.int64))) if len(series) else 0


def _month_gap(a: str, b: str) -> int:
    return abs((int(a[:4]) * 12 + int(a[5:7])) - (int(b[:4]) * 12 + int(b[5:7])))


def _family_existed(spend: pd.DataFrame) -> set[tuple[str, str]]:
    la = spend[spend.level == "local-authority"]
    g = la.groupby(["family", "fiscal_year"]).value_gbp.sum()
    return {k for k, v in g.items() if v > 0}


def _numerators_spend(metric: Metric, spend: pd.DataFrame, areas: pd.DataFrame, existed: set) -> pd.DataFrame:
    rows = spend[spend.benefit_code.isin(metric.codes)]
    keep_break = len(metric.families) == 1
    out = []
    for level in LEVELS:
        lvl = rows[rows.level == level]
        codes = areas[areas.level == level].code
        for fy, year_rows in lvl.groupby("fiscal_year"):
            needed = {f for f in metric.families if (f, fy) in existed}
            by_area = year_rows.groupby("code")
            num = by_area.value_gbp.sum()
            fl = by_area["flags"].agg(_or)
            fams = by_area.family.agg(lambda s: set(s.dropna()))
            frame = pd.DataFrame({"code": codes.to_numpy()})
            frame["numerator"] = frame.code.map(num)
            frame["flags"] = frame.code.map(fl).fillna(0).astype(int)
            missing = frame.code.map(lambda c, f=fams, n=needed: bool(n - f.get(c, set())))
            complete = (~missing).mean()
            if complete < COMPLETE_SHARE:
                continue
            frame.loc[missing, "flags"] |= flags.PARTIAL_COVERAGE
            if not keep_break:
                frame["flags"] &= ~flags.SERIES_BREAK
            out.append(frame.assign(level=level, period=fy))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def _numerators_caseload(metric: Metric, caseload: pd.DataFrame, areas: pd.DataFrame) -> pd.DataFrame:
    rows = caseload[caseload.benefit_code.isin(metric.codes)]
    dwp = rows[rows.source == "dwp-stat-xplore"]
    sss = rows[rows.source != "dwp-stat-xplore"]
    out = []
    for level in LEVELS:
        codes = areas[areas.level == level]
        months = sorted(dwp[dwp.level == level].month.unique())
        if not months:
            continue
        latest = months[-1]
        months = [m for m in months if _month_gap(m, latest) <= CLAIMANT_HISTORY_MONTHS]
        devolved = any(BY_CODE[c].administrator == "SSS" for c in metric.codes)
        for month in months:
            part = dwp[(dwp.level == level) & (dwp.month == month)]
            if month == latest:
                lvl_sss = sss[sss.level == level]
                lvl_sss = lvl_sss[[_month_gap(m, latest) <= SSS_MONTH_TOLERANCE for m in lvl_sss.month]]
                part = pd.concat([part, lvl_sss])
            by_area = part.groupby("code")
            frame = pd.DataFrame({"code": codes.code.to_numpy()})
            frame["numerator"] = frame.code.map(by_area.caseload.sum(min_count=1))
            frame["flags"] = frame.code.map(by_area["flags"].agg(_or)).fillna(0).astype(int)
            if devolved:
                scottish_gap = frame.code.str.startswith("S") & frame.numerator.isna()
                frame.loc[scottish_gap, "flags"] |= flags.PARTIAL_COVERAGE
            out.append(frame.assign(level=level, period=month))
    return pd.concat(out, ignore_index=True)


def _numerators_tax(tax: pd.DataFrame, areas: pd.DataFrame) -> pd.DataFrame:
    out = []
    for level in LEVELS:
        codes = areas[areas.level == level]
        lvl = tax[tax.level == level]
        for fy, year_rows in lvl.groupby("fiscal_year"):
            r = year_rows.set_index("code")
            frame = pd.DataFrame({"code": codes.code.to_numpy()})
            frame["numerator"] = frame.code.map(r.income_tax_gbp)
            frame["flags"] = frame.code.map(r["flags"]).fillna(flags.SURVEY | flags.SUPPRESSED).astype(int)
            out.append(frame.assign(level=level, period=fy))
    return pd.concat(out, ignore_index=True)


def _ratio(spend_num: pd.DataFrame, tax_num: pd.DataFrame) -> pd.DataFrame:
    m = spend_num.merge(tax_num, on=["level", "period", "code"], suffixes=("_spend", "_tax"))
    m["numerator"] = m.numerator_spend / m.numerator_tax
    m["flags"] = (m.flags_spend | m.flags_tax).astype(int)
    m["tax"] = m.numerator_tax
    m["spend"] = m.numerator_spend
    return m[["level", "period", "code", "numerator", "flags", "spend", "tax"]]


def _population_year(metric: Metric, period: str) -> int:
    return CASELOAD_POPULATION_YEAR if metric.kind == "caseload" else int(period[:4])


def _apply_denominators(metric: Metric, nums: pd.DataFrame, population: pd.DataFrame) -> list[pd.DataFrame]:
    nums = nums.copy()
    nums["mid_year"] = nums.period.map(lambda p: _population_year(metric, p))
    nums = nums.merge(population, on=["level", "code", "mid_year"], how="left")
    out = []
    for denominator in metric.denominators:
        df = nums.copy()
        if denominator == "total":
            df["band"] = np.nan
            df["value"] = df.numerator
        else:
            df["band"] = df[BAND[denominator]]
            df["value"] = df.numerator / df.band * metric.rate_scale
            small = df.band < SMALL_POPULATION
            df.loc[small, "flags"] |= flags.SMALL_POPULATION
        df["value"] = df.value.where(np.isfinite(df.value))
        out.append(df.assign(metric=metric.id, denominator=denominator))
    return out


def compute(tables: dict[str, pd.DataFrame], derive: Callable[[pd.DataFrame], pd.DataFrame] | None = None) -> Values:
    """Every metric's values. `derive` builds the `residual` metrics from the
    others' values, before ranks and GB values are computed over all of them."""
    areas = tables["dim_area"]
    spend = tables["fact_spend_area"]
    population = tables["fact_population"][
        ["level", "code", "mid_year", "total", "aged_0_15", "aged_16_64", "aged_66_plus"]
    ]
    existed = _family_existed(spend)
    tax_num = _numerators_tax(tables["fact_tax_area"], areas)
    frames: list[pd.DataFrame] = []
    spend_total = None
    for metric in METRICS:
        if metric.kind == "spend":
            nums = _numerators_spend(metric, spend, areas, existed)
            if metric.id == "spend-total":
                spend_total = nums
        elif metric.kind == "caseload":
            nums = _numerators_caseload(metric, tables["fact_caseload_area"], areas)
        elif metric.kind == "tax":
            nums = tax_num
        elif metric.kind == "residual":
            continue
        else:
            assert spend_total is not None, "spend-total must precede the ratio"
            nums = _ratio(spend_total, tax_num)
        frames += _apply_denominators(metric, nums, population)
    values = pd.concat(frames, ignore_index=True)
    if derive is not None:
        values = pd.concat([values, derive(values)], ignore_index=True)
    values["flags"] = values["flags"].astype(int)
    values.loc[values.value.isna() & (values.metric == "income-tax"), "flags"] |= flags.SUPPRESSED

    keys = ["metric", "denominator", "level", "period"]
    rankable = values.value.notna() & ((values["flags"] & EXCLUDED_FROM_RANK) == 0)
    values["rank"] = values.value.where(rankable).groupby([values[k] for k in keys]).rank(ascending=False, method="min")
    values["rank_of"] = rankable.groupby([values[k] for k in keys]).transform("sum").astype(int)

    gb = _gb_values(values)
    coverage = _coverage(values, areas)
    return Values(values=values, gb=gb, coverage=coverage)


def _gb_values(values: pd.DataFrame) -> pd.DataFrame:
    """One GB value per metric, denominator and period, shared by every level.

    The GB numerator and the GB population are both summed over councils
    (`GB_LEVEL`), whose populations are the official mid-year estimates.
    Summing constituencies instead gives a slightly different total and
    population, so a constituency page and a council page would show two GB
    figures for one measure. Every published constituency period has a
    council one."""
    by_id = {m.id: m for m in METRICS}
    keys = ["metric", "denominator", "period"]
    gb = {}
    for (metric, denominator, period), g in values[values.level == GB_LEVEL].groupby(keys):
        m = by_id[metric]
        if m.kind == "ratio":
            ok = g.spend.notna() & g.tax.notna()
            gb[(metric, denominator, period)] = g.spend[ok].sum() / g.tax[ok].sum() if ok.any() else np.nan
        elif denominator == "total":
            gb[(metric, denominator, period)] = g.numerator.sum(min_count=1)
        else:
            ok = g.numerator.notna() & g.band.notna()
            gb[(metric, denominator, period)] = (
                g.numerator[ok].sum() / g.band[ok].sum() * m.rate_scale if ok.any() else np.nan
            )
    rows = []
    for (metric, denominator, level, period), _ in values.groupby(["metric", "denominator", "level", "period"]):
        key = (metric, denominator, period)
        assert key in gb, f"{key} is published for {level} but not for {GB_LEVEL}, so it has no GB value"
        rows.append(
            {"metric": metric, "denominator": denominator, "level": level, "period": period, "gb_value": gb[key]}
        )
    return pd.DataFrame(rows)


def _coverage(values: pd.DataFrame, areas: pd.DataFrame) -> pd.DataFrame:
    nation = dict(zip(zip(areas.level, areas.code, strict=True), areas.nation, strict=True))
    v = values[values.denominator == values.groupby("metric").denominator.transform("first")].copy()
    v["nation"] = [nation[k] for k in zip(v.level, v.code, strict=True)]
    v["ok"] = v.value.notna() & ((v["flags"] & flags.PARTIAL_COVERAGE) == 0)
    share = v.groupby(["metric", "period", "level", "nation"]).ok.mean().reset_index()
    covered = share[share.ok >= COMPLETE_SHARE].groupby(["metric", "period", "nation"])["level"].nunique().reset_index()
    levels = v.groupby(["metric", "period"])["level"].nunique().rename("levels").reset_index()
    covered = covered.merge(levels, on=["metric", "period"])
    covered = covered[covered["level"] == covered["levels"]]
    order = {"england": 0, "wales": 1, "scotland": 2}
    out = covered.groupby(["metric", "period"]).nation.agg(lambda s: sorted(s, key=order.__getitem__)).reset_index()
    full = v[["metric", "period"]].drop_duplicates()
    out = full.merge(out, on=["metric", "period"], how="left")
    out["nation"] = out.nation.map(lambda x: x if isinstance(x, list) else [])
    return out.rename(columns={"nation": "nations"})
