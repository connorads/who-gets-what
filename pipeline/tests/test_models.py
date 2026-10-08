"""Modelled spending: published coefficients reproduce every modelled value."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from wgw_pipeline import flags
from wgw_pipeline.compile import bundle, models


def _fits(read_json) -> dict:
    return {f["metric"]: f for f in read_json("meta/catalogue.json")["models"]["expected"]["fits"]}


def test_published_coefficients_reproduce_every_modelled_value(tables, release_root: Path, read_json) -> None:
    fits = _fits(read_json)
    assert set(fits) == {s.metric for s in models.EXPECTED}
    for level in ("constituency", "local-authority"):
        profile = models.profile(tables, level)
        x = models.design(profile)
        for spec in models.EXPECTED:
            terms = fits[spec.metric]["levels"][level]["terms"]
            assert [t["id"] for t in terms] == [tid for tid, _ in models.TERMS]
            expected = x @ np.array([t["coefficient"] for t in terms])
            for i in range(0, len(profile), 37):
                entry = next(
                    e
                    for e in json.loads((release_root / f"area/{level}/{profile.code[i]}.json").read_text())["expected"]
                    if e["metric"] == spec.metric
                )
                if np.isfinite(expected[i]):
                    assert entry["expected"] == pytest.approx(expected[i], abs=0.05)
                else:
                    assert entry["expected"] is None and entry["missingInputs"]


def test_residuals_balance_over_the_fit_and_match_the_residual_bundles(release_root: Path, read_json) -> None:
    fits = _fits(read_json)
    for level in ("constituency", "local-authority"):
        codes = [a["code"] for a in read_json(f"meta/areas-{level}.json")["areas"]]
        for spec in models.EXPECTED:
            header, (values, value_flags) = bundle.decode(
                (release_root / f"series/{level}/{spec.metric}/{spec.denominator}.bin").read_bytes()
            )
            assert header["periods"] == [models.PERIOD]
            assert (value_flags & flags.MODELLED).all()
            fitted = np.isfinite(values) & ((value_flags & models.EXCLUDED_FROM_RANK) == 0)
            assert fitted.sum() == fits[spec.metric]["levels"][level]["observations"]
            assert abs(float(values[fitted].mean())) < 0.01 * float(np.abs(values[fitted]).mean())
            i = codes.index(codes[len(codes) // 2])
            entry = next(
                e for e in read_json(f"area/{level}/{codes[i]}.json")["expected"] if e["metric"] == spec.metric
            )
            assert entry["residual"] == pytest.approx(float(values[i]), abs=0.01)
            assert (release_root / f"layout/{level}/swarm/{spec.metric}/{spec.denominator}.bin").exists()


def test_areas_without_pay_are_named_and_left_unmodelled(tables, read_json) -> None:
    withheld = tables["fact_context"].query("indicator == 'median-annual-pay'")
    for level in ("constituency", "local-authority"):
        codes = [a["code"] for a in read_json(f"meta/areas-{level}.json")["areas"]]
        missing = sorted(set(codes) - set(withheld[withheld.level == level].code))
        assert 0 < len(missing) < 10
        for code in missing:
            for entry in read_json(f"area/{level}/{code}.json")["expected"]:
                assert entry["missingInputs"] == ["median-pay"]
                assert entry["expected"] is None and entry["residual"] is None


def test_each_nation_uses_its_own_index_and_level(tables) -> None:
    deciles = tables["fact_context"].query("indicator == 'deprivation-decile'")
    source = {"E": "iod-2025", "W": "wimd-2025", "S": "simd-2020"}
    assert (deciles.code.str[0].map(source) == deciles.source).all()
    for nation in ("england", "wales", "scotland"):
        per_level = deciles.assign(nation=deciles.code.str[0].map({"E": "england", "W": "wales", "S": "scotland"}))
        assert set(per_level[per_level.nation == nation].value.astype(int)) == set(range(1, 11))
    assert [tid for tid, _ in models.TERMS][-2:] == ["nation-wales", "nation-scotland"]
