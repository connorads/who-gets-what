"""Beeswarm, ring and boundary layouts."""

from __future__ import annotations

import math

import numpy as np

from wgw_pipeline.compile import layout


def test_beeswarm_circles_do_not_overlap_and_are_deterministic() -> None:
    rng = np.random.default_rng(1)
    x = np.concatenate([rng.normal(0.5, 0.08, 600).clip(0, 1), [np.nan, np.nan]])
    radius = 0.0045
    y1 = layout.beeswarm(x, radius, seed=7)
    y2 = layout.beeswarm(x, radius, seed=7)

    assert np.array_equal(y1, y2, equal_nan=True)
    assert np.isnan(y1[-2:]).all()
    pts = np.column_stack([x[:-2], y1[:-2]])
    d = np.hypot(*(pts[:, None, :] - pts[None, :, :]).transpose(2, 0, 1))
    np.fill_diagonal(d, np.inf)
    assert d.min() >= 2 * radius - 1e-9


def test_swarm_x_spans_the_domain_and_log_scale_drops_non_positive_values() -> None:
    x, domain = layout.swarm_x(np.array([2.0, 4.0, np.nan, 8.0]), "linear")
    assert domain == (2.0, 8.0)
    assert x[0] == 0 and x[-1] == 1 and np.isnan(x[2])

    x, domain = layout.swarm_x(np.array([0.5, 1.0, 2.0, 0.0]), "log")
    assert domain == (0.5, 2.0)
    assert math.isclose(x[1], 0.5) and np.isnan(x[3])


def test_ring_has_equal_spacing_starts_north_and_runs_clockwise() -> None:
    # A square with a small island: only the larger polygon is used.
    square = [[0.0, 50.0], [0.0, 51.0], [1.0, 51.0], [1.0, 50.0], [0.0, 50.0]]
    island = [[2.0, 50.0], [2.1, 50.0], [2.1, 50.1], [2.0, 50.0]]
    geometry = {"type": "MultiPolygon", "coordinates": [[island], [square[::-1]]]}

    pts = layout.ring(geometry, points=64)

    assert pts.shape == (64, 2)
    assert pts[0].tolist() == [0.0, 51.0]
    assert pts[:, 0].max() <= 1.0
    signed = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    assert signed < 0
    # Clockwise from the north-west corner heads east first.
    assert pts[1][0] > pts[0][0] and pts[1][1] == 51.0


def test_generalise_keeps_a_polygon_and_rounds_coordinates() -> None:
    ring_coords = [[0.0, 0.0], [0.00001, 0.5], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]
    out = layout.generalise({"type": "Polygon", "coordinates": [ring_coords]})

    assert out["type"] == "Polygon"
    assert all(len(str(c).split(".")[-1]) <= layout.COORD_DECIMALS for p in out["coordinates"][0] for c in p)
    assert len(out["coordinates"][0]) == 5


def test_small_areas_keep_more_detail_than_large_ones() -> None:
    def square(side: float) -> dict:
        return {"type": "Polygon", "coordinates": [[[0, 52], [side, 52], [side, 52 + side], [0, 52 + side], [0, 52]]]}

    small, large = layout.simplify_tolerance(square(0.02)), layout.simplify_tolerance(square(2.0))
    assert layout.SIMPLIFY_MIN <= small < large == layout.SIMPLIFY_MAX


def _signed_area(points: np.ndarray) -> float:
    return 0.5 * float(np.sum(points[:, 0] * np.roll(points[:, 1], -1) - np.roll(points[:, 0], -1) * points[:, 1]))


def _triangle_area(points: np.ndarray, triangles: np.ndarray) -> float:
    a, b, c = (points[triangles[:, k]] for k in range(3))
    u, v = b - a, c - a
    return float(np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]).sum() / 2)


def test_shapes_keep_every_polygon_with_holes_wound_and_triangulated() -> None:
    outer = [[0.0, 50.0], [0.0, 51.0], [1.0, 51.0], [1.0, 50.0], [0.0, 50.0]]
    hole = [[0.2, 50.2], [0.4, 50.2], [0.4, 50.4], [0.2, 50.4], [0.2, 50.2]]
    island = [[2.0, 50.0], [2.1, 50.0], [2.1, 50.1], [2.0, 50.0]]
    with_island = {"type": "MultiPolygon", "coordinates": [[outer, hole], [island]]}
    plain = {"type": "Polygon", "coordinates": [island]}

    s = layout.build_shapes([with_island, plain])

    assert s.areas.tolist() == [0, 2, 3]
    assert len(s.polygons) - 1 == 3 and len(s.rings) - 1 == 4
    assert np.diff(s.rings).tolist() in ([4, 4, 3, 3], [3, 4, 4, 3])
    for p in range(3):
        for r in range(s.polygons[p], s.polygons[p + 1]):
            winding = _signed_area(s.lon_lat[s.rings[r] : s.rings[r + 1]])
            assert (winding > 0) == (r == s.polygons[p])
    assert math.isclose(_triangle_area(s.lon_lat, s.triangles), 1 - 0.04 + 0.005 + 0.005)


def test_a_ring_that_crosses_itself_is_repaired_before_it_is_triangulated() -> None:
    # A bow tie: the ring crosses itself at (0.5, 50.5).
    bow = {"type": "Polygon", "coordinates": [[[0, 50], [1, 51], [1, 50], [0, 51], [0, 50]]]}

    s = layout.build_shapes([bow])

    assert len(s.polygons) - 1 == 2
    assert math.isclose(_triangle_area(s.lon_lat, s.triangles), 0.5)


def test_quantised_shapes_round_trip_inside_half_a_step() -> None:
    square = {"type": "Polygon", "coordinates": [[[0, 50], [0, 51], [1, 51], [1, 50], [0, 50]]]}
    triangle = {"type": "Polygon", "coordinates": [[[2, 50], [2.5, 50], [2.5, 50.5], [2, 50]]]}
    s = layout.build_shapes([square, triangle])
    bounds = layout.bounds_of(s.lon_lat)

    xy, local, offsets = layout.quantise(s, bounds)

    (west, south), (east, north) = bounds
    back = xy / layout.QUANTA * [east - west, north - south] + [west, south]
    assert np.abs(back - s.lon_lat).max() <= 0.5 * (east - west) / layout.QUANTA + 1e-12
    assert offsets.tolist() == [0, 2, 3]
    first = s.rings[s.polygons[:-1]]
    assert (local[offsets[1] :] + first[1] == s.triangles[offsets[1] :]).all()


def test_sprite_paths_close_every_ring_on_its_vertices() -> None:
    square = {"type": "Polygon", "coordinates": [[[0, 50], [0, 51], [1, 51], [1, 50], [0, 50]]]}
    s = layout.build_shapes([square])
    bounds = layout.bounds_of(s.lon_lat)

    svg = layout.sprite(s, bounds)

    assert svg.count('<path id="a0" d="m') == 1 and svg.count("z") == 1
    moves = svg.split('d="m')[1].split("z")[0].replace("l", " ").split()
    walked = np.cumsum(np.array([float(v) for v in moves]).reshape(-1, 2), axis=0)
    corner = layout.world_xy(np.array([[0.0, 51.0]]))
    expected = (layout.world_xy(s.lon_lat) - corner) * layout.SPRITE_SCALE
    assert np.abs(walked - expected).max() < 0.06
