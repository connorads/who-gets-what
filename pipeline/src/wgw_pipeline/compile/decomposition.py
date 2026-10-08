"""Change in annual spending split into population, claim-rate and award-size effects.

Annual run-rate spending for a benefit is V = P x R x A x 52: P is the
eligible population (the age band the benefit serves), R = claimants / P is
the claim rate, and A is the mean weekly award. With the logarithmic mean
L(a, b) = (a - b) / (ln a - ln b), and L(a, a) = a, the log-mean Divisia index
(LMDI-I) splits the change between two months into

    population effect  = L(V1, V0) x ln(P1 / P0)
    claim-rate effect  = L(V1, V0) x ln(R1 / R0)
    award-size effect  = L(V1, V0) x ln(A1 / A0)

The three sum exactly to V1 - V0, and swapping the months only flips their
signs, so neither month is the base. Real terms multiply each month's award by
the price factor of the fiscal year it falls in; the population and claim-rate
effects then change only through L.

The release publishes the inputs (P, claimants, nominal A at both months);
`decompose` in src/domain/decomposition.ts computes the effects for the
reader's basis, and `effects` here is the same calculation for tests. Both
agree on contract/fixtures/decomposition-golden.json.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.compile.values import CASELOAD_POPULATION_YEAR, COMPLETE_SHARE, LEVELS, SMALL_POPULATION

MIN_MONTHS_APART = 24


@dataclass(frozen=True)
class FamilySpec:
    family: str
    benefit: str  # canonical benefit code counted
    band: str  # fact_population column
    denominator: str
    claimant_unit: str  # people | households


FAMILIES: tuple[FamilySpec, ...] = (
    FamilySpec("state-pension", "SP", "aged_66_plus", "per-aged-66-plus", "people"),
    FamilySpec("pension-credit", "PC", "aged_66_plus", "per-aged-66-plus", "people"),
    FamilySpec("attendance-allowance", "AA", "aged_66_plus", "per-aged-66-plus", "people"),
    FamilySpec("personal-independence", "PIP", "total", "per-resident", "people"),
    FamilySpec("disability-living", "DLA", "total", "per-resident", "people"),
    FamilySpec("carers", "CA_16_64", "aged_16_64", "per-aged-16-64", "people"),
    FamilySpec("universal-credit", "UC_HH", "aged_16_64", "per-aged-16-64", "households"),
    FamilySpec("housing-benefit", "HB", "total", "per-resident", "people"),
    FamilySpec("employment-support", "ESA", "aged_16_64", "per-aged-16-64", "people"),
    FamilySpec("jobseekers", "JSA", "aged_16_64", "per-aged-16-64", "people"),
)

INPUT_COLUMNS = ("population_from", "population_to", "claimants_from", "claimants_to", "award_from", "award_to")


@dataclass(frozen=True)
class FamilyDecomposition:
    spec: FamilySpec
    from_month: str
    to_month: str
    population_years: tuple[int, int]
    nations: list[str]
    # Per level: one row per area in area order, INPUT_COLUMNS (NaN when not
    # available) and `flags`.
    areas: dict[str, pd.DataFrame]
    # Per level: GB inputs, summed over the areas with every input.
    gb: dict[str, dict[str, float]]


def population_year(month: str) -> int:
    """The mid-year estimate nearest a snapshot month, held at the latest published."""
    return min(int(month[:4]), CASELOAD_POPULATION_YEAR)


def _months_apart(a: str, b: str) -> int:
    return (int(b[:4]) * 12 + int(b[5:7])) - (int(a[:4]) * 12 + int(a[5:7]))


def log_mean(a: float, b: float) -> float:
    return a if math.isclose(a, b, rel_tol=1e-12) else (a - b) / (math.log(a) - math.log(b))


def effects(
    population: tuple[float, float],
    claimants: tuple[float, float],
    award: tuple[float, float],
    factors: tuple[float, float] = (1.0, 1.0),
) -> dict[str, float]:
    """Annual spending at both months and the three effects, with each month's
    award multiplied by its price factor."""
    real = (award[0] * factors[0], award[1] * factors[1])
    v0 = claimants[0] * real[0] * 52
    v1 = claimants[1] * real[1] * 52
    weight = log_mean(v1, v0)
    rate0, rate1 = claimants[0] / population[0], claimants[1] / population[1]
    return {
        "from": v0,
        "to": v1,
        "population": weight * math.log(population[1] / population[0]),
        "claimRate": weight * math.log(rate1 / rate0),
        "awardSize": weight * math.log(real[1] / real[0]),
    }


def compute(tables: dict[str, pd.DataFrame]) -> list[FamilyDecomposition]:
    caseload = tables["fact_caseload_area"]
    caseload = caseload[caseload.source == "dwp-stat-xplore"]
    population = tables["fact_population"]
    areas = tables["dim_area"]
    out = []
    for spec in FAMILIES:
        rows = caseload[caseload.benefit_code == spec.benefit]
        months = sorted(rows.month.unique())
        from_month, to_month = months[0], months[-1]
        assert _months_apart(from_month, to_month) >= MIN_MONTHS_APART, (spec.family, from_month, to_month)
        years = (population_year(from_month), population_year(to_month))
        by_level, gb, nation_ok = {}, {}, []
        for level in LEVELS:
            lvl_areas = areas[areas.level == level].sort_values("code")
            codes = lvl_areas.code.to_numpy()
            frame = pd.DataFrame({"code": codes})
            pop = population[population.level == level].set_index(["code", "mid_year"])[spec.band]
            lvl = rows[rows.level == level].set_index(["code", "month"])
            for side, month, year in (("from", from_month, years[0]), ("to", to_month, years[1])):
                frame[f"population_{side}"] = [pop.get((c, year), np.nan) for c in codes]
                frame[f"claimants_{side}"] = [lvl.caseload.get((c, month), np.nan) for c in codes]
                frame[f"award_{side}"] = [lvl.mean_weekly_gbp.get((c, month), np.nan) for c in codes]
            values = frame[list(INPUT_COLUMNS)]
            complete = (values > 0).all(axis=1)
            frame.loc[~complete, list(INPUT_COLUMNS)] = np.nan
            small = (frame.population_from < SMALL_POPULATION) | (frame.population_to < SMALL_POPULATION)
            frame["flags"] = np.where(small, flags.SMALL_POPULATION, 0)
            by_level[level] = frame
            ok = frame[complete]
            gb[level] = {
                "population_from": float(ok.population_from.sum()),
                "population_to": float(ok.population_to.sum()),
                "claimants_from": float(ok.claimants_from.sum()),
                "claimants_to": float(ok.claimants_to.sum()),
                "award_from": float((ok.claimants_from * ok.award_from).sum() / ok.claimants_from.sum()),
                "award_to": float((ok.claimants_to * ok.award_to).sum() / ok.claimants_to.sum()),
            }
            share = pd.Series(complete.to_numpy(), index=lvl_areas.nation.to_numpy()).groupby(level=0).mean()
            nation_ok.append({n for n, s in share.items() if s >= COMPLETE_SHARE})
        order = ("england", "wales", "scotland")
        nations = [n for n in order if all(n in ok for ok in nation_ok)]
        out.append(FamilyDecomposition(spec, from_month, to_month, years, nations, by_level, gb))
    return out
