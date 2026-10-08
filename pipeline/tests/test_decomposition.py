"""Change decomposition: the shared golden effects and the compiled inputs."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from wgw_pipeline import flags
from wgw_pipeline.compile import bundle
from wgw_pipeline.compile.decomposition import FAMILIES, effects, population_year


def test_effects_match_the_golden_fixture_shared_with_the_app(fixtures_dir: Path) -> None:
    golden = json.loads((fixtures_dir / "decomposition-golden.json").read_text())
    inputs = golden["inputs"]
    fy_from, fy_to = "2023-24", "2026-27"
    for basis, key in (("nominal", None), ("real-gdp", "realGdp"), ("real-cpi", "realCpi")):
        factors = (1.0, 1.0) if key is None else (golden["factors"][fy_from][key], golden["factors"][fy_to][key])
        got = effects(
            tuple(inputs["population"]), tuple(inputs["claimants"]), tuple(inputs["meanWeeklyAward"]), factors
        )
        want = golden["expected"][basis]
        for name in ("from", "to", "population", "claimRate", "awardSize"):
            assert got[name] == pytest.approx(want[name], rel=1e-9), (basis, name)
        assert got["population"] + got["claimRate"] + got["awardSize"] == pytest.approx(got["to"] - got["from"])


def test_population_is_held_at_the_latest_estimate() -> None:
    assert population_year("2023-02") == 2023
    assert population_year("2026-03") == 2024


def _decode(release_root: Path, level: str, family: str) -> tuple[dict, dict[str, np.ndarray]]:
    header, arrays = bundle.decode((release_root / f"decomposition/{level}/{family}.bin").read_bytes())
    names = [s["name"] for s in header["sections"]]
    return header, dict(zip(names, arrays, strict=True))


def test_compiled_inputs_agree_across_catalogue_bundles_and_dossiers(release_root: Path, read_json) -> None:
    cat = read_json("meta/catalogue.json")
    entries = {e["family"]: e for e in cat["decomposition"]["families"]}
    assert set(entries) == {f.family for f in FAMILIES}
    years = {y["id"] for y in cat["fiscalYears"]}
    for spec in FAMILIES:
        entry = entries[spec.family]
        assert entry["benefit"] == spec.benefit and entry["denominator"] == spec.denominator
        assert entry["from"] < entry["to"]
        for month in (entry["from"], entry["to"]):
            start = int(month[:4]) if int(month[5:]) >= 4 else int(month[:4]) - 1
            assert f"{start}-{(start + 1) % 100:02d}" in years
        for level in ("constituency", "local-authority"):
            header, arrays = _decode(release_root, level, spec.family)
            assert (header["from"], header["to"]) == (entry["from"], entry["to"])
            n = header["areaCount"]
            pop, claimants = arrays["population"].reshape(2, n), arrays["claimants"].reshape(2, n)
            ok = np.isfinite(pop).all(axis=0) & np.isfinite(claimants).all(axis=0)
            gb = entry["gb"][level]
            assert pop[:, ok].sum(axis=1) == pytest.approx(gb["population"], rel=1e-5)
            assert claimants[:, ok].sum(axis=1) == pytest.approx(gb["claimants"], rel=1e-5)
            codes = [a["code"] for a in read_json(f"meta/areas-{level}.json")["areas"]]
            scottish = np.array([c.startswith("S") for c in codes])
            if "scotland" in entry["nations"]:
                assert ok[scottish].mean() > 0.9
            else:
                assert not ok[scottish].any(), spec.family
            first = codes.index(next(c for c, good in zip(codes, ok, strict=True) if good))
            dossier = read_json(f"area/{level}/{codes[first]}.json")
            item = next(d for d in dossier["decomposition"] if d["family"] == spec.family)
            assert item["population"] == [round(float(v)) for v in pop[:, first]]


def test_devolved_families_leave_scotland_out_and_small_populations_are_flagged(release_root: Path, read_json) -> None:
    entries = {e["family"]: e for e in read_json("meta/catalogue.json")["decomposition"]["families"]}
    for family in ("attendance-allowance", "personal-independence", "disability-living", "carers"):
        assert entries[family]["nations"] == ["england", "wales"]
    for family in ("state-pension", "universal-credit"):
        assert entries[family]["nations"] == ["england", "wales", "scotland"]
    header, arrays = _decode(release_root, "local-authority", "state-pension")
    pop = arrays["population"].reshape(2, header["areaCount"])
    small = (pop < 1000).any(axis=0)
    assert small.any()
    assert (arrays["flags"][small] & flags.SMALL_POPULATION).all()
