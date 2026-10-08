"""Precomputed layouts: beeswarm positions, morph rings, generalised boundaries and map shapes."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.polygon import orient

POINTS_PER_RING = 64
SWARM_RADIUS = {"constituency": 0.0045, "local-authority": 0.006}
# Generalisation tolerance in degrees: a share of the square root of the
# area's size (its east-west scale corrected), so small urban areas keep detail
# and large rural ones lose more, within these bounds (about 55 m to 890 m).
SIMPLIFY_SHARE = 0.03
SIMPLIFY_MIN = 0.0005
SIMPLIFY_MAX = 0.008
COORD_DECIMALS = 4


# ------------------------------------------------------------------ beeswarm


def swarm_x(values: np.ndarray, scale: str) -> tuple[np.ndarray, tuple[float, float]]:
    """Positions 0..1 across the period's domain, and the domain in data units."""
    finite = np.isfinite(values) & ((values > 0) if scale == "log" else True)
    if not finite.any():
        return np.full(values.shape, np.nan), (0.0, 1.0)
    lo, hi = float(values[finite].min()), float(values[finite].max())
    x = np.full(values.shape, np.nan)
    if hi == lo:
        x[finite] = 0.5
    elif scale == "log":
        x[finite] = (np.log(values[finite]) - math.log(lo)) / (math.log(hi) - math.log(lo))
    else:
        x[finite] = (values[finite] - lo) / (hi - lo)
    return x, (lo, hi)


def beeswarm(x: np.ndarray, radius: float, seed: int) -> np.ndarray:
    """Vertical offsets so circles of `radius` centred at (x, y) do not overlap.

    Points are placed in order of x (ties in a seeded shuffle); each takes the
    free position nearest the axis, and a seeded coin picks the side when both
    are equally near. The same inputs and seed always give the same layout.
    """
    rng = np.random.default_rng(seed)
    n = len(x)
    y = np.full(n, np.nan)
    tiebreak = rng.permutation(n)
    order = [i for i in np.lexsort((tiebreak, x)) if np.isfinite(x[i])]
    diameter = 2 * radius
    xs = np.empty(0)
    ys = np.empty(0)
    for i in order:
        near = np.abs(xs - x[i]) < diameter
        nx, ny = xs[near], ys[near]
        candidates = [0.0]
        for xj, yj in zip(nx, ny, strict=True):
            dy = math.sqrt(max(diameter**2 - (x[i] - xj) ** 2, 0.0))
            candidates += [yj + dy, yj - dy]
        sign = 1.0 if rng.random() < 0.5 else -1.0
        best = None
        for c in sorted(candidates, key=lambda c: (abs(c), -sign * c)):
            if np.all((nx - x[i]) ** 2 + (ny - c) ** 2 >= diameter**2 - 1e-12):
                best = c
                break
        y[i] = best if best is not None else 0.0
        xs = np.append(xs, x[i])
        ys = np.append(ys, y[i])
    return y


# ---------------------------------------------------------------------- rings


def _largest_polygon(geometry: dict[str, Any]) -> Polygon:
    geom = shape(geometry)
    if isinstance(geom, MultiPolygon):
        return max(geom.geoms, key=lambda p: p.area)
    assert isinstance(geom, Polygon)
    return geom


def ring(geometry: dict[str, Any], points: int = POINTS_PER_RING) -> np.ndarray:
    """The largest polygon's outer ring, `points` vertices at equal arc length,
    starting at its northernmost vertex and running clockwise."""
    coords = np.asarray(_largest_polygon(geometry).exterior.coords)[:-1]
    lat0 = math.radians(float(coords[:, 1].mean()))
    projected = np.column_stack([coords[:, 0] * math.cos(lat0), coords[:, 1]])
    signed_area = 0.5 * np.sum(
        projected[:, 0] * np.roll(projected[:, 1], -1) - np.roll(projected[:, 0], -1) * projected[:, 1]
    )
    if signed_area > 0:  # counter-clockwise
        coords, projected = coords[::-1], projected[::-1]
    start = int(np.lexsort((coords[:, 0], -coords[:, 1]))[0])
    coords = np.roll(coords, -start, axis=0)
    projected = np.roll(projected, -start, axis=0)
    closed = np.vstack([projected, projected[:1]])
    closed_ll = np.vstack([coords, coords[:1]])
    seg = np.hypot(*np.diff(closed, axis=0).T)
    cumulative = np.concatenate([[0.0], np.cumsum(seg)])
    targets = np.arange(points) * cumulative[-1] / points
    lon = np.interp(targets, cumulative, closed_ll[:, 0])
    lat = np.interp(targets, cumulative, closed_ll[:, 1])
    return np.column_stack([lon, lat])


# ------------------------------------------------------------------- geojson


def _round(obj: Any) -> Any:
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], float):
            return [round(v, COORD_DECIMALS) for v in obj]
        return [_round(o) for o in obj]
    return obj


def simplify_tolerance(geometry: dict[str, Any]) -> float:
    geom = shape(geometry)
    scaled_area = geom.area * math.cos(math.radians(geom.centroid.y))
    return min(SIMPLIFY_MAX, max(SIMPLIFY_MIN, SIMPLIFY_SHARE * math.sqrt(scaled_area)))


def generalise(geometry: dict[str, Any]) -> dict[str, Any]:
    tolerance = simplify_tolerance(geometry)
    geom = shape(geometry).simplify(tolerance, preserve_topology=True)
    if isinstance(geom, MultiPolygon):
        kept = [p for p in geom.geoms if not p.is_empty and p.area > tolerance**2]
        parts = kept or [max(geom.geoms, key=lambda p: p.area)]
        geom = MultiPolygon(parts) if len(parts) > 1 else parts[0]
    out = mapping(geom)
    return {"type": out["type"], "coordinates": _round(out["coordinates"])}


# -------------------------------------------------------------------- shapes

# The map sprite's units: Web Mercator world pixels at this zoom (512-pixel
# tiles, as deck.gl's MapView), from the level's north-west corner. A tenth
# of a unit is about 75 m at British latitudes, finer than the generalisation.
SPRITE_ZOOM = 7
SPRITE_SCALE = 512 * 2**SPRITE_ZOOM

Bounds = tuple[tuple[float, float], tuple[float, float]]


@dataclass(frozen=True)
class Shapes:
    """Every polygon of every area, in area order, ready for the GPU.

    `lon_lat` holds each ring's vertices once (no closing repeat): a polygon's
    outer ring counter-clockwise, then its holes clockwise. `rings`,
    `polygons` and `areas` are start offsets with a final end entry: ring r
    is vertices rings[r] to rings[r + 1], polygon p is rings polygons[p] to
    polygons[p + 1], area a is polygons areas[a] to areas[a + 1].
    `triangles` index `lon_lat` directly.
    """

    lon_lat: np.ndarray
    rings: np.ndarray
    polygons: np.ndarray
    areas: np.ndarray
    triangles: np.ndarray


def polygons_of(geometry: dict[str, Any]) -> list[Polygon]:
    """The geometry's polygons, made valid, outer rings counter-clockwise and holes clockwise.

    Generalising and rounding can leave a ring touching or crossing itself,
    which no triangulation accepts; repairing keeps every covered point.
    """
    geom = shapely.make_valid(shape(geometry), method="structure")
    parts = shapely.get_parts(geom)
    return [orient(p, sign=1.0) for p in parts if isinstance(p, Polygon) and not p.is_empty]


def triangulate(polygon: Polygon) -> np.ndarray:
    """Triangles over the polygon's own vertices, as indices into its open rings in order."""
    rings = [polygon.exterior, *polygon.interiors]
    index: dict[tuple[float, float], int] = {}
    at = 0
    for ring_coords in rings:
        for x, y in ring_coords.coords[:-1]:
            index.setdefault((x, y), at)
            at += 1
    triangles = shapely.constrained_delaunay_triangles(polygon)
    out = [[index[(x, y)] for x, y in t.exterior.coords[:-1]] for t in triangles.geoms]
    return np.asarray(out, dtype=np.int64).reshape(-1, 3)


def build_shapes(geometries: Sequence[dict[str, Any]]) -> Shapes:
    """Shapes for each geometry in order; one area per geometry."""
    lon_lat: list[np.ndarray] = []
    rings = [0]
    polygons = [0]
    areas = [0]
    triangles: list[np.ndarray] = []
    vertices = 0
    for geometry in geometries:
        for polygon in polygons_of(geometry):
            triangles.append(triangulate(polygon) + vertices)
            for ring_coords in [polygon.exterior, *polygon.interiors]:
                points = np.asarray(ring_coords.coords)[:-1, :2]
                lon_lat.append(points)
                vertices += len(points)
                rings.append(vertices)
            polygons.append(len(rings) - 1)
        areas.append(len(polygons) - 1)
    return Shapes(
        lon_lat=np.vstack(lon_lat),
        rings=np.asarray(rings),
        polygons=np.asarray(polygons),
        areas=np.asarray(areas),
        triangles=np.vstack(triangles),
    )


QUANTA = 65_535


def quantise(shapes: Shapes, bounds: Bounds) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The bundle's compact form: vertices as 16-bit steps across `bounds`, and
    each polygon's triangles as 16-bit indices from its first vertex, with the
    triangle offset of each polygon (a final end entry)."""
    (west, south), (east, north) = bounds
    xy = np.rint((shapes.lon_lat - [west, south]) / [east - west, north - south] * QUANTA)
    first = shapes.rings[shapes.polygons[:-1]]
    owner = np.searchsorted(first, shapes.triangles[:, 0], side="right") - 1
    local = shapes.triangles - first[owner][:, None]
    assert local.min() >= 0 and local.max() <= QUANTA, "a polygon has more vertices than 16 bits index"
    counts = np.bincount(owner, minlength=len(first))
    offsets = np.concatenate([[0], np.cumsum(counts)])
    return xy.astype(np.uint16), local.astype(np.uint16), offsets


def bounds_of(lon_lat: np.ndarray) -> Bounds:
    """[[west, south], [east, north]], rounded outwards to the boundaries' four decimals."""
    west, south = np.floor(lon_lat.min(axis=0) * 1e4) / 1e4
    east, north = np.ceil(lon_lat.max(axis=0) * 1e4) / 1e4
    return ((float(west), float(south)), (float(east), float(north)))


def area_bounds(shapes: Shapes, areas: Sequence[int]) -> Bounds:
    """The extent of some areas' polygons."""
    picked = []
    for a in areas:
        first = shapes.rings[shapes.polygons[shapes.areas[a]]]
        last = shapes.rings[shapes.polygons[shapes.areas[a + 1]]]
        picked.append(shapes.lon_lat[first:last])
    return bounds_of(np.vstack(picked))


def world_xy(lon_lat: np.ndarray) -> np.ndarray:
    """Web Mercator world coordinates, 0 to 1, y down: deck.gl's `MapView` maths."""
    lon = lon_lat[:, 0]
    sin = np.sin(np.radians(lon_lat[:, 1]))
    return np.column_stack([(lon + 180) / 360, 0.5 - np.log((1 + sin) / (1 - sin)) / (4 * math.pi)])


def _tenths(value: int) -> str:
    """An integer count of tenths as the shortest decimal."""
    sign = "-" if value < 0 else ""
    whole, tenth = divmod(abs(int(value)), 10)
    return f"{sign}{whole}" + (f".{tenth}" if tenth else "")


def sprite(shapes: Shapes, bounds: Bounds) -> str:
    """An SVG sprite with one path per area (`a{index}`), for server-rendered maps.

    Coordinates are world pixels at SPRITE_ZOOM from the bounds' north-west
    corner, written as relative moves in whole tenths, so rounding never
    drifts along a ring; every ring closes.
    """
    (west, south), (east, north) = bounds
    corners = world_xy(np.array([[west, north], [east, south]]))
    tenths = np.rint((world_xy(shapes.lon_lat) - corners[0]) * SPRITE_SCALE * 10).astype(np.int64)
    width, height = np.ceil((corners[1] - corners[0]) * SPRITE_SCALE * 10).astype(np.int64)
    paths = []
    for a in range(len(shapes.areas) - 1):
        d: list[str] = []
        pen = np.zeros(2, dtype=np.int64)
        for r in range(shapes.polygons[shapes.areas[a]], shapes.polygons[shapes.areas[a + 1]]):
            ring_tenths = tenths[shapes.rings[r] : shapes.rings[r + 1]]
            start = ring_tenths[0] - pen
            steps = [f"{_tenths(dx)} {_tenths(dy)}" for dx, dy in np.diff(ring_tenths, axis=0) if dx or dy]
            d.append(f"m{_tenths(start[0])} {_tenths(start[1])}" + (f"l{' '.join(steps)}" if steps else "") + "z")
            pen = ring_tenths[0]
        paths.append(f'<path id="a{a}" d="{"".join(d)}"/>')
    view = f"0 0 {_tenths(width)} {_tenths(height)}"
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" fill-rule="evenodd">{"".join(paths)}</svg>\n'
