"""Statistical neighbours: nearest areas on the published profile."""

from __future__ import annotations

import numpy as np
import pytest

from wgw_pipeline.compile import neighbours


def test_nearest_skips_self_breaks_ties_by_order_and_rescales_for_missing_features() -> None:
    z = np.array([[0.0, 0.0], [1.0, 0.0], [-1.0, 0.0], [0.0, np.nan], [5.0, 5.0]])
    order, distance = neighbours.nearest(z, 2)

    assert order[0].tolist() == [3, 1]  # area 3 matches on its one feature: distance 0
    assert distance[0].tolist() == [0.0, 1.0]
    assert 0 not in order[0]
    # Area 3 compares on one feature of two, so a gap of 1 counts as sqrt(2).
    assert distance[3, 1] == pytest.approx(np.sqrt(2))
    assert order[3].tolist() == [0, 1]


def test_dossiers_list_the_nearest_areas_on_the_published_profile(tables, read_json) -> None:
    cat = read_json("meta/catalogue.json")["models"]["neighbours"]
    assert cat["count"] == neighbours.COUNT and cat["features"] == list(neighbours.FEATURES)
    for level in ("constituency", "local-authority"):
        p = neighbours.features(tables, level)
        raw = p[list(neighbours.FEATURES.values())].to_numpy(dtype=float)
        z = (raw - np.nanmean(raw, axis=0)) / np.nanstd(raw, axis=0)
        for i in range(0, len(p), 53):
            dossier = read_json(f"area/{level}/{p.code[i]}.json")
            listed = dossier["neighbours"]["areas"]
            assert len(listed) == neighbours.COUNT
            assert p.code[i] not in {a["code"] for a in listed}
            d = np.sqrt(np.nansum((z - z[i]) ** 2, axis=1) * z.shape[1] / np.isfinite(z - z[i]).sum(axis=1))
            d[i] = np.inf
            nearest = np.argsort(d, kind="stable")[: neighbours.COUNT]
            assert [a["code"] for a in listed] == p.code[nearest].tolist()
            assert [a["distance"] for a in listed] == pytest.approx(d[nearest], abs=0.001)


def test_every_area_has_a_land_area_and_density(tables) -> None:
    areas = tables["dim_area"]
    assert (areas.area_km2 > 0).all()
    for level in ("constituency", "local-authority"):
        p = neighbours.features(tables, level)
        assert np.isfinite(p.log_density).all()
    # The City of London is the densest council; Highland one of the sparsest.
    la = neighbours.features(tables, "local-authority").set_index("code").log_density
    assert la.idxmin() in {"S12000017", "S12000013", "S12000035"}
