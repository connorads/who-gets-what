"""Statistical neighbours: the areas of the same level most alike in profile.

Each area's profile has five features, each standardised to mean 0 and
standard deviation 1 across the level:

- share of residents aged 0 to 15, and aged 66 and over (the share aged 16 to
  64 is close to the remainder, so it is left out and age counts twice, not
  three times);
- deprivation decile within the nation;
- natural log of median annual pay;
- natural log of residents per square kilometre.

Distance is Euclidean over the features both areas have, scaled up by
sqrt(5 / features compared) when one lacks a feature. Each area lists its
COUNT nearest areas across Great Britain, nearest first, ties by code.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from wgw_pipeline.compile.models import profile
from wgw_pipeline.compile.values import LEVELS

COUNT = 15
FEATURES = {
    "share-aged-0-15": "share_0_15",
    "share-aged-66-plus": "share_66_plus",
    "deprivation-decile": "decile",
    "median-pay": "log_pay",
    "population-density": "log_density",
}


@dataclass(frozen=True)
class Neighbours:
    # Per level, in area order: neighbour indices, distances and missing feature ids.
    index: dict[str, np.ndarray]
    distance: dict[str, np.ndarray]
    missing: dict[str, list[list[str]]]


def features(tables: dict[str, pd.DataFrame], level: str) -> pd.DataFrame:
    p = profile(tables, level)
    area = tables["dim_area"].query("level == @level").set_index("code").area_km2
    p["log_density"] = np.log(p.total / p.code.map(area))
    return p


def nearest(z: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """For each row of standardised features `z` (NaN where missing), the
    indices and distances of its `count` nearest other rows. Rows are in code
    order, so a stable sort breaks ties by code."""
    _, f = z.shape
    have = np.isfinite(z)
    filled = np.where(have, z, 0.0)
    both = have[:, None, :] & have[None, :, :]
    diff = (filled[:, None, :] - filled[None, :, :]) ** 2
    shared = both.sum(axis=2)
    with np.errstate(invalid="ignore", divide="ignore"):
        d = np.sqrt((diff * both).sum(axis=2) * f / shared)
    d[shared == 0] = np.inf
    np.fill_diagonal(d, np.inf)
    order = np.argsort(d, axis=1, kind="stable")[:, :count]
    return order, np.take_along_axis(d, order, axis=1)


def compute(tables: dict[str, pd.DataFrame]) -> Neighbours:
    index, distance, missing = {}, {}, {}
    for level in LEVELS:
        p = features(tables, level)
        raw = p[list(FEATURES.values())].to_numpy(dtype=float)
        z = (raw - np.nanmean(raw, axis=0)) / np.nanstd(raw, axis=0)
        index[level], distance[level] = nearest(z, COUNT)
        missing[level] = [[fid for fid, col in FEATURES.items() if not np.isfinite(r[col])] for _, r in p.iterrows()]
    return Neighbours(index, distance, missing)
