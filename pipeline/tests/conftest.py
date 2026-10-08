"""Shared fixtures. Tests that need pipeline output skip when it has not been built.

Unit tests always run. Honesty tests read `build/canonical` and `build/staged`;
contract tests read the newest compiled release in `build/site`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from wgw_pipeline.canonical.build import TABLES
from wgw_pipeline.paths import CANONICAL, CONTRACT_DIR, SITE, STAGED, canonical, staged


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    return CONTRACT_DIR / "fixtures"


@pytest.fixture(scope="session")
def schemas() -> dict[str, dict[str, Any]]:
    return {
        p.name.removesuffix(".schema.json"): json.loads(p.read_text())
        for p in (CONTRACT_DIR / "schema").glob("*.schema.json")
    }


@pytest.fixture(scope="session")
def tables() -> dict[str, pd.DataFrame]:
    if not all(canonical(n).exists() for n in TABLES):
        pytest.skip("canonical tables not built: run `pnpm run data:compile`")
    return {n: pd.read_parquet(canonical(n)) for n in TABLES}


@pytest.fixture(scope="session")
def staged_table():
    def load(name: str) -> pd.DataFrame:
        path = staged(name)
        if not path.exists():
            pytest.skip(f"staged table {name} not built: run `pnpm run data:ingest`")
        return pd.read_parquet(path)

    return load


@pytest.fixture(scope="session")
def qa_table():
    def load(name: str) -> pd.DataFrame:
        path = CANONICAL / f"{name}.parquet"
        if not path.exists():
            pytest.skip(f"{name} not built")
        return pd.read_parquet(path)

    return load


@pytest.fixture(scope="session")
def release_root() -> Path:
    releases = sorted(p for p in SITE.glob("*") if (p / "manifest.json").exists()) if SITE.exists() else []
    if not releases:
        pytest.skip("no compiled release: run `pnpm run data:compile`")
    return releases[-1]


@pytest.fixture(scope="session")
def read_json(release_root: Path):
    def load(rel: str) -> Any:
        return json.loads((release_root / rel).read_text())

    return load


@pytest.fixture(scope="session")
def staged_dir() -> Path:
    return STAGED
