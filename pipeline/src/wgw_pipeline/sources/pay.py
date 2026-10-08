"""Median pay of residents from the Annual Survey of Hours and Earnings (ONS).

Nomis NM_30_1, resident analysis: median gross annual pay of full-time
employees living in each area, in April of `YEAR`, which falls in fiscal year
2024-25. Local authorities use TYPE424 (April 2023 councils), constituencies
TYPE172 (July 2024 boundaries). ONS withholds unreliable estimates; those
areas have no value.
"""

from __future__ import annotations

import sys

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged
from wgw_pipeline.sources.population import fetch_nomis

DATASET = "NM_30_1"
YEAR = 2024
PARAMS = {
    "date": YEAR,
    "sex": 8,  # full-time workers
    "item": 2,  # median
    "pay": 7,  # annual pay, gross
    "measures": 20100,
    "select": "GEOGRAPHY_CODE,DATE,OBS_VALUE,OBS_STATUS",
}
GEOGRAPHY = {"local-authority": "TYPE424", "constituency": "TYPE172"}


def ingest(cache: RawCache) -> None:
    frames = []
    for level, geography in GEOGRAPHY.items():
        rows = fetch_nomis(cache, DATASET, {"geography": geography, **PARAMS})
        rows = rows[~rows.GEOGRAPHY_CODE.str.startswith("N")]
        frames.append(
            pd.DataFrame(
                {
                    "level": level,
                    "code": rows.GEOGRAPHY_CODE,
                    "year": rows.DATE.astype(int),
                    "median_annual_pay_gbp": pd.to_numeric(rows.OBS_VALUE, errors="coerce"),
                    "status": rows.OBS_STATUS,
                }
            )
        )
    out = pd.concat(frames, ignore_index=True)
    out.to_parquet(staged("pay"), index=False)
    missing = out[out.median_annual_pay_gbp.isna()]
    print(f"  pay: {len(out)} areas, {len(missing)} withheld: {missing.code.tolist()}", file=sys.stderr)
