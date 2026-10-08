"""The compiled release conforms to the data contract that src/domain defines.

JSON files validate against the generated schemas in contract/schema; the
cross-field rules the TypeScript `parse*` functions add are checked here too.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator, FormatChecker

from wgw_pipeline.compile import bundle

LEVELS = ("constituency", "local-authority")
ENTITY = {"constituency": ("E14", "W07", "S14"), "local-authority": ("E06", "E07", "E08", "E09", "W06", "S12")}


def validate(schema: dict, instance: object, label: str) -> None:
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(instance), key=str)
    assert not errors, f"{label}: " + "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:5])


def test_every_json_file_validates_against_its_schema(release_root: Path, schemas) -> None:
    validate(schemas["manifest"], json.loads((release_root / "manifest.json").read_text()), "manifest.json")
    validate(schemas["catalogue"], json.loads((release_root / "meta/catalogue.json").read_text()), "catalogue")
    for level in LEVELS:
        validate(schemas["areas-meta"], json.loads((release_root / f"meta/areas-{level}.json").read_text()), level)
        validate(schemas["gb-values"], json.loads((release_root / f"meta/gb-{level}.json").read_text()), level)
    dossiers = sorted((release_root / "area").rglob("*.json"))
    assert len(dossiers) == 632 + 350
    for path in dossiers:
        validate(schemas["area-dossier"], json.loads(path.read_text()), path.name)


def test_every_bundle_header_validates_and_its_sections_fit(release_root: Path, schemas, read_json) -> None:
    hashes = {lvl: read_json(f"meta/areas-{lvl}.json")["areaOrderHash"] for lvl in LEVELS}
    bins = sorted(release_root.rglob("*.bin"))
    assert bins
    for path in bins:
        header, arrays = bundle.decode(path.read_bytes())
        validate(schemas["bundle-header"], header, str(path.relative_to(release_root)))
        assert header["areaOrderHash"] == hashes[header["level"]]
        n = header["areaCount"]
        if header["kind"] == "series":
            assert [s["name"] for s in header["sections"]] == ["values", "flags"]
            assert arrays[0].size == arrays[1].size == len(header["periods"]) * n
        elif header["kind"] == "swarm":
            assert len(header["domains"]) == len(header["periods"])
            assert arrays[0].size == len(header["periods"]) * n * 2
        elif header["kind"] == "decomposition":
            assert [s["name"] for s in header["sections"]] == ["population", "claimants", "meanWeeklyAward", "flags"]
            assert [a.size for a in arrays] == [2 * n, 2 * n, 2 * n, n]
        elif header["kind"] == "shapes":
            names = ["xy", "rings", "polygons", "areas", "triangles", "polygonTriangles"]
            assert [s["name"] for s in header["sections"]] == names
            xy, rings, polygons, areas, triangles, polygon_triangles = arrays
            assert areas.size == n + 1 and areas[-1] == polygons.size - 1
            assert polygons[-1] == rings.size - 1 and rings[-1] == xy.size // 2
            assert polygon_triangles.size == polygons.size and polygon_triangles[-1] == triangles.size // 3
        else:
            assert arrays[0].size == n * header["pointsPerRing"] * 2


def test_areas_are_sorted_coded_for_their_level_and_hash_to_the_published_order(read_json) -> None:
    manifest = read_json("manifest.json")
    for level in LEVELS:
        meta = read_json(f"meta/areas-{level}.json")
        codes = [a["code"] for a in meta["areas"]]
        assert codes == sorted(set(codes))
        assert all(c.startswith(ENTITY[level]) for c in codes)
        regions = {r["code"] for r in meta["regions"]}
        assert all(a["region"] in regions for a in meta["areas"])
        recomputed = hashlib.sha256("\n".join(codes).encode()).hexdigest()[:16]
        assert meta["areaOrderHash"] == recomputed == manifest["levels"][level]["areaOrderHash"]
        assert (
            manifest["levels"][level]["areaCount"] == len(codes) == {"constituency": 632, "local-authority": 350}[level]
        )


def test_catalogue_cross_field_rules(read_json) -> None:
    cat = read_json("meta/catalogue.json")
    years = {y["id"]: y for y in cat["fiscalYears"]}
    sources = {s["id"] for s in cat["sources"]}
    caveats = {c["id"] for c in cat["caveats"]}
    base = years[cat["priceBase"]]
    assert base["realGdp"] == 1 and base["realCpi"] == 1
    assert cat["defaultMetric"] in {m["id"] for m in cat["metrics"]}
    for level in LEVELS:
        assert any(level in m["levels"] for m in cat["metrics"])
    for m in cat["metrics"]:
        assert m["defaultDenominator"] in m["denominators"]
        if m["unit"] == "ratio":
            assert m["denominators"] == ["total"]
        assert (m["unit"] == "people") == (m["rateScale"] == 1000)
        assert m["periods"] == sorted(set(m["periods"]))
        if m["unit"] == "gbp" and m["periodKind"] == "fiscal-year":
            assert set(m["periods"]) <= set(years), m["id"]
        assert set(m["sources"]) <= sources and set(m["caveats"]) <= caveats, m["id"]
        assert [c["period"] for c in m["coverage"]] == m["periods"]


def test_dossier_cross_field_rules(release_root: Path, read_json) -> None:
    rank_of = {
        level: {
            (g["metric"], g["denominator"], p): n
            for g in read_json(f"meta/gb-{level}.json")["series"]
            for p, n in zip(g["periods"], g["rankOf"], strict=True)
        }
        for level in LEVELS
    }
    for level in LEVELS:
        other = "local-authority" if level == "constituency" else "constituency"
        for path in (release_root / "area" / level).glob("*.json"):
            d = json.loads(path.read_text())
            assert d["level"] == level and path.stem == d["area"]["code"]
            assert all(o["level"] == other for o in d["overlaps"])
            assert (d["representation"] is None) or level == "constituency"
            assert abs(sum(o["populationShare"] for o in d["overlaps"]) - 1) < 0.01
            for f in d["facts"]:
                n = len(f["denominators"])
                assert len(set(f["denominators"])) == n
                assert all(len(f[k]) == n for k in ("values", "flags", "ranks")), f["metric"]
                for denominator, rank in zip(f["denominators"], f["ranks"], strict=True):
                    assert rank is None or rank <= rank_of[level][(f["metric"], denominator, f["period"])]
            for s in d["series"]:
                assert len(s["values"]) == len(s["flags"]) == len(s["periods"]), s["metric"]
                assert s["periods"] == sorted(set(s["periods"]))


def test_fixtures_validate_against_their_schemas(fixtures_dir: Path, schemas) -> None:
    for name, schema in (
        ("manifest.json", "manifest"),
        ("catalogue.json", "catalogue"),
        ("areas-constituency.json", "areas-meta"),
        ("area-constituency-S14000021.json", "area-dossier"),
        ("gb-constituency.json", "gb-values"),
    ):
        validate(schemas[schema], json.loads((fixtures_dir / name).read_text()), name)


def test_manifest_lists_every_file_with_its_hash(release_root: Path, read_json) -> None:
    files = read_json("manifest.json")["files"]
    on_disk = {p.relative_to(release_root).as_posix() for p in release_root.rglob("*") if p.is_file()} - {
        "manifest.json"
    }
    assert set(files) == on_disk
    for rel in list(files)[:: max(1, len(files) // 50)]:
        data = (release_root / rel).read_bytes()
        assert files[rel] == {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def test_geojson_features_are_indexed_in_area_order(release_root: Path, read_json) -> None:
    for level in LEVELS:
        doc = json.loads((release_root / f"geo/{level}.geojson").read_text())
        assert [f["properties"] for f in doc["features"]] == [{"i": i} for i in range(len(doc["features"]))]
        assert len(doc["features"]) == len(read_json(f"meta/areas-{level}.json")["areas"])


def test_rings_start_north_and_run_clockwise(release_root: Path) -> None:
    for level in LEVELS:
        header, (lon_lat,) = bundle.decode((release_root / f"layout/{level}/rings.bin").read_bytes())
        rings = lon_lat.reshape(header["areaCount"], header["pointsPerRing"], 2).astype(np.float64)
        assert header["pointsPerRing"] == 64
        assert np.isfinite(rings).all()
        for r in rings:
            assert r[0, 1] >= r[:, 1].max() - 1e-4
            area = np.sum(r[:, 0] * np.roll(r[:, 1], -1) - np.roll(r[:, 0], -1) * r[:, 1])
            assert area < 0


def test_shapes_cover_every_area_with_triangles_inside_their_bounds(release_root: Path, read_json) -> None:
    from shapely.geometry import shape

    for level in LEVELS:
        meta = read_json(f"meta/areas-{level}.json")
        header, (xy, rings, polygons, areas, triangles, polygon_triangles) = bundle.decode(
            (release_root / f"layout/{level}/shapes.bin").read_bytes()
        )
        assert header["bounds"] == meta["bounds"]
        (west, south), (east, north) = header["bounds"]
        lon_lat = xy.reshape(-1, 2) / 65535 * [east - west, north - south] + [west, south]
        assert (np.diff(areas) >= 1).all(), "every area has a polygon"
        features = json.loads((release_root / f"geo/{level}.geojson").read_text())["features"]
        for a in range(header["areaCount"]):
            covered = 0.0
            for p in range(areas[a], areas[a + 1]):
                first = rings[polygons[p]]
                tri = triangles[polygon_triangles[p] * 3 : polygon_triangles[p + 1] * 3].reshape(-1, 3) + first
                assert tri.max() < rings[polygons[p + 1]]
                pa, pb, pc = (lon_lat[tri[:, k]] for k in range(3))
                u, v = pb - pa, pc - pa
                covered += float(np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]).sum() / 2)
            published = shape(features[a]["geometry"]).buffer(0).area
            assert covered == pytest.approx(published, rel=0.02, abs=2e-6), (level, a)
        regions = {r["code"]: r["bounds"] for r in meta["regions"]}
        for i, area in enumerate(meta["areas"]):
            (rw, rs), (re, rn) = regions[area["region"]]
            span = lon_lat[rings[polygons[areas[i]]] : rings[polygons[areas[i + 1]]]]
            assert (span >= [rw - 1e-3, rs - 1e-3]).all() and (span <= [re + 1e-3, rn + 1e-3]).all()


def test_map_sprite_draws_one_path_per_area(release_root: Path, read_json) -> None:
    for level in LEVELS:
        svg = (release_root / f"layout/{level}/map.svg").read_text()
        count = len(read_json(f"meta/areas-{level}.json")["areas"])
        assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"')
        assert [f'id="a{i}"' in svg for i in (0, count - 1)] == [True, True]
        assert svg.count("<path ") == count


@pytest.mark.parametrize("budget", [{"files": 2000, "bytes": 150_000_000, "file": 25 * 1024 * 1024}])
def test_release_stays_inside_the_size_budget(release_root: Path, budget) -> None:
    files = [p for p in release_root.rglob("*") if p.is_file()]
    assert len(files) < budget["files"]
    assert sum(p.stat().st_size for p in files) < budget["bytes"]
    assert max(p.stat().st_size for p in files) < budget["file"]
