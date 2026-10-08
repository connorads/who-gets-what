"""Filesystem layout. Everything the pipeline writes lives under `pipeline/build/`."""

from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = PIPELINE_DIR.parent
CONTRACT_DIR = REPO_ROOT / "contract"

BUILD = PIPELINE_DIR / "build"
RAW = BUILD / "raw"
STAGED = BUILD / "staged"
CANONICAL = BUILD / "canonical"
SITE = BUILD / "site"
RELEASES = BUILD / "release"


def staged(name: str) -> Path:
    return STAGED / f"{name}.parquet"


def canonical(name: str) -> Path:
    return CANONICAL / f"{name}.parquet"
