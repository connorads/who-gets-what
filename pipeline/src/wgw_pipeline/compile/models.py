"""Modelled comparisons: spending against the level modelled from area profile.

Each model regresses one spending metric, per person in its band, on
measures of the area's profile, across all areas of a level (ordinary least
squares):

    spending per person = intercept
        + b1 x share of residents aged 0 to 15
        + b2 x share of residents aged 66 and over
        + b3 x deprivation decile within the nation (1 is the most deprived tenth)
        + b4 x natural log of median annual pay
        + a level for Wales and one for Scotland (England is the reference)

The share aged 16 to 64 is the remainder, so it is not a term. Areas enter the
fit when they have every input and a rankable value (not small-population,
partial-coverage or suppressed). Every area with every input gets a modelled
value, and the residual metric publishes actual minus modelled, flagged
modelled. The coefficients, standard errors and fit are published in the
catalogue, so anyone can recompute a value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.compile.spec import BAND, MODELLED
from wgw_pipeline.compile.values import EXCLUDED_FROM_RANK, LEVELS

# Fiscal year modelled: the pay survey is April 2024 and the population mid-2024.
PERIOD = "2024-25"
POPULATION_YEAR = 2024
NATIONS = ("wales", "scotland")


@dataclass(frozen=True)
class ExpectedSpec:
    metric: str  # the residual metric
    actual: str
    denominator: str
    band: str


EXPECTED: tuple[ExpectedSpec, ...] = tuple(
    ExpectedSpec(f"{actual}-vs-model", actual, denominator, BAND[denominator]) for actual, denominator in MODELLED
)

# Inputs an area can lack: the published input ids, as the dossier names them.
INPUT_COLUMNS = {
    "share-aged-0-15": "share_0_15",
    "share-aged-66-plus": "share_66_plus",
    "deprivation-decile": "decile",
    "median-pay": "log_pay",
}
TERMS = (
    ("intercept", "Intercept"),
    ("share-aged-0-15", "Share of residents aged 0 to 15, from 0 to 1"),
    ("share-aged-66-plus", "Share of residents aged 66 and over, from 0 to 1"),
    ("deprivation-decile", "Deprivation decile within the nation, 1 to 10, where 1 is the most deprived tenth"),
    ("log-median-pay", "Natural logarithm of median yearly pay of full-time employees who live in the area"),
    ("nation-wales", "Wales, compared with England"),
    ("nation-scotland", "Scotland, compared with England"),
)


@dataclass(frozen=True)
class Fit:
    observations: int
    r_squared: float
    coefficients: list[float]
    standard_errors: list[float]


def profile(tables: dict[str, pd.DataFrame], level: str) -> pd.DataFrame:
    """Model inputs for every area of a level, in area order, NaN where missing."""
    areas = tables["dim_area"].query("level == @level").sort_values("code")
    pop = tables["fact_population"].query("level == @level and mid_year == @POPULATION_YEAR").set_index("code")
    context = tables["fact_context"].query("level == @level")
    by = {ind: g.set_index("code").value for ind, g in context.groupby("indicator")}
    out = pd.DataFrame({"code": areas.code.to_numpy(), "nation": areas.nation.to_numpy()})
    out["share_0_15"] = out.code.map(pop.aged_0_15 / pop.total)
    out["share_66_plus"] = out.code.map(pop.aged_66_plus / pop.total)
    out["decile"] = out.code.map(by["deprivation-decile"])
    out["pay"] = out.code.map(by["median-annual-pay"])
    out["log_pay"] = np.log(out.pay)
    for band in ("total", "aged_16_64", "aged_66_plus"):
        out[band] = out.code.map(pop[band])
    return out


def design(p: pd.DataFrame) -> np.ndarray:
    columns = [np.ones(len(p)), p.share_0_15, p.share_66_plus, p.decile, p.log_pay]
    columns += [(p.nation == n).astype(float) for n in NATIONS]
    return np.column_stack(columns).astype(float)


def ols(x: np.ndarray, y: np.ndarray) -> Fit:
    coef, *_ = np.linalg.lstsq(x, y, rcond=None)
    resid = y - x @ coef
    n, k = x.shape
    sigma2 = float(resid @ resid) / (n - k)
    se = np.sqrt(np.diag(sigma2 * np.linalg.inv(x.T @ x)))
    r2 = 1 - float(resid @ resid) / float(((y - y.mean()) ** 2).sum())
    return Fit(n, r2, [float(c) for c in coef], [float(s) for s in se])


@dataclass
class Expected:
    """Fits the models from metric values; `rows` is the hook `values.compute` calls."""

    tables: dict[str, pd.DataFrame]
    fits: dict[tuple[str, str], Fit] = field(default_factory=dict)
    # (metric, level) -> area-order frame: actual, expected, residual, flags, missing
    areas: dict[tuple[str, str], pd.DataFrame] = field(default_factory=dict)

    def rows(self, values: pd.DataFrame) -> pd.DataFrame:
        out = []
        for level in LEVELS:
            p = profile(self.tables, level)
            missing = [[i for i, col in INPUT_COLUMNS.items() if not np.isfinite(r[col])] for _, r in p.iterrows()]
            x = design(p)
            has_inputs = np.isfinite(x).all(axis=1)
            for spec in EXPECTED:
                actual = values.query(
                    "metric == @spec.actual and denominator == @spec.denominator "
                    "and level == @level and period == @PERIOD"
                ).set_index("code")
                y = p.code.map(actual.value).to_numpy(dtype=float)
                actual_flags = p.code.map(actual["flags"]).fillna(0).astype(int).to_numpy()
                fit_rows = has_inputs & np.isfinite(y) & ((actual_flags & EXCLUDED_FROM_RANK) == 0)
                fit = ols(x[fit_rows], y[fit_rows])
                self.fits[(spec.metric, level)] = fit
                expected = np.where(has_inputs, x @ np.asarray(fit.coefficients), np.nan)
                residual = y - expected
                area_flags = actual_flags | flags.MODELLED
                self.areas[(spec.metric, level)] = pd.DataFrame(
                    {
                        "code": p.code,
                        "actual": y,
                        "expected": expected,
                        "residual": residual,
                        "flags": area_flags,
                        "missing": missing,
                    }
                )
                band = p[spec.band].to_numpy(dtype=float)
                out.append(
                    pd.DataFrame(
                        {
                            "code": p.code,
                            "numerator": residual * band,
                            "band": band,
                            "value": residual,
                            "flags": area_flags,
                            "level": level,
                            "period": PERIOD,
                            "metric": spec.metric,
                            "denominator": spec.denominator,
                        }
                    )
                )
        rows = pd.concat(out, ignore_index=True)
        rows["value"] = rows.value.where(np.isfinite(rows.value))
        return rows


def describe(fit: Fit) -> dict:
    return {
        "observations": fit.observations,
        "rSquared": round(fit.r_squared, 4),
        "terms": [
            {"id": tid, "label": label, "coefficient": _sig(c), "standardError": _sig(se)}
            for (tid, label), c, se in zip(TERMS, fit.coefficients, fit.standard_errors, strict=True)
        ],
    }


def _sig(value: float, digits: int = 6) -> float:
    """Round to `digits` significant figures."""
    if value == 0 or not math.isfinite(value):
        return value
    return round(value, digits - 1 - math.floor(math.log10(abs(value))))
