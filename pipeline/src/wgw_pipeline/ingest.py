"""Fetch every source into the raw cache and stage it as tidy Parquet."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pandas as pd

from wgw_pipeline import seed
from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import STAGED, staged
from wgw_pipeline.sources import (
    caseloads,
    deprivation,
    dwp_outturn,
    dwp_spend,
    geography,
    hmrc_spi,
    parliament,
    pay,
    population,
    prices,
    sss,
)

# Order matters: caseload queries list areas from the hex layouts and Nomis.
STEPS = {
    "geography": geography.ingest,
    "population": population.ingest,
    "dwp-spend": dwp_spend.ingest,
    "dwp-outturn": dwp_outturn.ingest,
    "hmrc-spi": hmrc_spi.ingest,
    "sss": sss.ingest,
    "deprivation": deprivation.ingest,
    "prices": prices.ingest,
    "parliament": parliament.ingest,
    "pay": pay.ingest,
    "caseloads": caseloads.ingest,
}


def run(*, refresh: bool, offline: bool, seed_from: Path | None, only: list[str] | None) -> None:
    STAGED.mkdir(parents=True, exist_ok=True)
    cache = RawCache(refresh=refresh, offline=offline)
    if seed_from is not None:
        seed.seed(cache, seed_from)
    for name, step in STEPS.items():
        if only and name not in only:
            continue
        started = time.monotonic()
        print(f"ingest {name}", file=sys.stderr)
        step(cache)
        print(f"  {name} done in {time.monotonic() - started:.0f}s", file=sys.stderr)
    _write_ledger(cache)


def _write_ledger(cache: RawCache) -> None:
    rows = [
        {
            "source": f.source,
            "url": f.url,
            "retrieved": f.retrieved.isoformat(),
            "last_modified": f.last_modified.isoformat() if f.last_modified else None,
            "sha256": f.sha256,
        }
        for f in cache.ledger
    ]
    new = pd.DataFrame(rows, columns=["source", "url", "retrieved", "last_modified", "sha256"])
    path = staged("retrievals")
    if path.exists():
        new = pd.concat([pd.read_parquet(path), new], ignore_index=True)
    new.drop_duplicates(["source", "url"], keep="last").to_parquet(path, index=False)
