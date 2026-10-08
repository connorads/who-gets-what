"""PIP condition groups: Scotland left out, withheld cells flagged, labels in sentence case."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from wgw_pipeline import flags
from wgw_pipeline.canonical import conditions


def _cells(level: str, code: str, counts: dict[str, float | None]) -> list[dict]:
    return [
        {"level": level, "code": code, "name": code, "month": "2026-07", "category_label": label, "caseload": n}
        for label, n in counts.items()
    ]


@pytest.fixture
def staged_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(conditions, "staged", lambda name: tmp_path / f"{name}.parquet")
    return tmp_path


def test_scotland_is_left_out_and_withheld_cells_are_flagged(staged_dir: Path) -> None:
    labels = {"Psychiatric disorders": 0.0, "Haematological Disease": 0.0, "Disability not recorded": 0.0}
    area = pd.DataFrame(
        _cells("constituency", "E14001063", {**labels, "Psychiatric disorders": 120, "Haematological Disease": None})
        + _cells("local-authority", "S12000036", {**labels, "Psychiatric disorders": 3})
    )
    country = pd.DataFrame(
        _cells("country", "E92000001", {**labels, "Psychiatric disorders": 900, "Haematological Disease": 40})
        + _cells("country", "S92000003", {**labels, "Psychiatric disorders": 5})
    )
    area.to_parquet(staged_dir / "pip_conditions_area.parquet")
    country.to_parquet(staged_dir / "pip_conditions_country.parquet")
    dim_area = pd.DataFrame({"level": ["constituency", "local-authority"], "code": ["E14001063", "S12000036"]})

    out = conditions.build(dim_area)

    assert not out.code.str.startswith("S").any()
    assert set(out.condition) == {"psychiatric-disorders", "haematological-disease"}
    assert set(out.condition_label) == {"Psychiatric disorders", "Haematological disease"}
    seat = out[out.code == "E14001063"].set_index("condition")
    assert pd.isna(seat.claimants["haematological-disease"])
    assert seat["flags"]["haematological-disease"] == flags.SUPPRESSED
    assert seat["flags"]["psychiatric-disorders"] == 0
