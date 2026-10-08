"""Write the site data contract (docs/architecture.md, "Data contract") for one release."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
import zlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.areas import REGION_NAMES
from wgw_pipeline.canonical.benefits import FAMILIES, family_members
from wgw_pipeline.canonical.build import TABLES
from wgw_pipeline.canonical.periods import PRICE_BASE
from wgw_pipeline.canonical.spend import ORKNEY_SHETLAND
from wgw_pipeline.compile import bundle, layout, models, neighbours
from wgw_pipeline.compile.decomposition import FamilyDecomposition
from wgw_pipeline.compile.spec import (
    CAVEATS,
    DECOMPOSITION_METHOD,
    DEFAULT_METRIC,
    EXPECTED_METHOD,
    METRICS,
    MODEL_INPUTS,
    NEIGHBOURS_METHOD,
    SOURCES,
    Metric,
)
from wgw_pipeline.compile.values import LEVELS, Values
from wgw_pipeline.paths import REPO_ROOT, STAGED, staged

SCHEMA_VERSION = 2
BOUNDARY_SET = {"constituency": "PCON24", "local-authority": "LAD23"}
POPULATION_PERIOD = "mid-2024"
OVERLAP_MIN_SHARE = 0.001
NOT_COVERED = [
    {
        "area": "Northern Ireland",
        "reason": "The Department for Communities runs benefits in Northern Ireland, and its figures are not in these sources.",
    }
]
METRIC_BY_ID = {m.id: m for m in METRICS}
SPLIT_CSV = ("fact_spend_area",)
# Every download in one file. It must stay under the 25 MiB Workers asset limit.
ARCHIVE = "all-tables.zip"


def _json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")


def _round(value: float | None, metric: Metric, denominator: str) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    if metric.unit == "ratio":
        return round(float(value), 4)
    if denominator == "total":
        return round(float(value), 0 if metric.unit == "gbp" else 1)
    return round(float(value), 2)


def _seed(*parts: str) -> int:
    return zlib.crc32("|".join(parts).encode())


def _fiscal_year(month: str) -> str:
    year, m = int(month[:4]), int(month[5:7])
    start = year if m >= 4 else year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def _money(value: float) -> float | None:
    return round(float(value), 2) if np.isfinite(value) else None


def _inputs(row: dict[str, float] | pd.Series) -> dict[str, list]:
    return {
        "population": [round(row["population_from"]), round(row["population_to"])],
        "claimants": [round(row["claimants_from"]), round(row["claimants_to"])],
        "meanWeeklyAward": [round(float(row["award_from"]), 2), round(float(row["award_to"]), 2)],
    }


class Release:
    def __init__(
        self,
        root: Path,
        release: str,
        tables: dict[str, pd.DataFrame],
        values: Values,
        decompositions: list[FamilyDecomposition],
        expected: models.Expected,
        peers: neighbours.Neighbours,
    ) -> None:
        self.root = root
        self.release = release
        self.tables = tables
        self.decompositions = decompositions
        self.expected = expected
        self.peers = peers
        self.values = values.values
        self.gb = values.gb.set_index(["metric", "denominator", "level", "period"]).gb_value
        self.coverage = values.coverage
        areas = tables["dim_area"]
        self.areas = {lvl: areas[areas.level == lvl].sort_values("code").reset_index(drop=True) for lvl in LEVELS}
        self.hash = {lvl: bundle.area_order_hash(a.code.tolist()) for lvl, a in self.areas.items()}
        self.periods = {(m, lvl): sorted(g.period.unique()) for (m, lvl), g in self.values.groupby(["metric", "level"])}

    # ------------------------------------------------------------------ meta

    def metric_levels(self, metric: Metric) -> list[str]:
        return [lvl for lvl in LEVELS if (metric.id, lvl) in self.periods]

    def write_areas(self, level: str, shapes: layout.Shapes) -> None:
        df = self.areas[level]
        regions = sorted(set(df.region_code))
        members = {r: df.index[df.region_code == r].tolist() for r in regions}
        _json(
            self.root / f"meta/areas-{level}.json",
            {
                "schemaVersion": SCHEMA_VERSION,
                "release": self.release,
                "level": level,
                "boundarySet": BOUNDARY_SET[level],
                "areaOrderHash": self.hash[level],
                "populationPeriod": POPULATION_PERIOD,
                "hexLayout": "odd-r",
                "bounds": layout.bounds_of(shapes.lon_lat),
                "regions": [
                    {
                        "code": r,
                        "name": REGION_NAMES[r],
                        "nation": df[df.region_code == r].nation.iloc[0],
                        "bounds": layout.area_bounds(shapes, members[r]),
                    }
                    for r in regions
                ],
                "areas": [
                    {
                        "code": a.code,
                        "name": a.name,
                        "slug": a.slug,
                        "nation": a.nation,
                        "region": a.region_code,
                        "hex": {"q": int(a.hex_q), "r": int(a.hex_r)},
                        "centroid": [round(float(a.lon), 5), round(float(a.lat), 5)],
                        "population": int(a.population),
                    }
                    for a in df.itertuples()
                ],
            },
        )

    def write_catalogue(self, retrievals: pd.DataFrame, extra_caveats: set[str]) -> None:
        metrics = []
        used_years: set[str] = {PRICE_BASE}
        for m in METRICS:
            levels = self.metric_levels(m)
            periods = sorted({p for lvl in levels for p in self.periods[(m.id, lvl)]})
            if m.unit == "gbp" and m.period_kind == "fiscal-year":
                used_years |= set(periods)
            cov = self.coverage[self.coverage.metric == m.id].set_index("period").nations
            metrics.append(
                {
                    "id": m.id,
                    "label": m.label,
                    "shortLabel": m.short_label,
                    "description": m.description,
                    "unit": m.unit,
                    "rateScale": m.rate_scale,
                    "levels": levels,
                    "denominators": list(m.denominators),
                    "defaultDenominator": m.default_denominator,
                    "periodKind": m.period_kind,
                    "periods": periods,
                    "families": list(m.families),
                    "provenance": m.provenance,
                    "sources": list(m.sources),
                    "caveats": list(m.caveats),
                    "coverage": [{"period": p, "nations": list(cov.get(p, []))} for p in periods],
                }
            )
        families = [
            {
                "id": f.id,
                "label": f.label,
                "description": f.description,
                "members": [
                    {
                        "code": b.code,
                        "label": b.label,
                        "administrator": b.administrator,
                        "nations": list(b.nations),
                        "from": b.from_fy,
                        "to": b.to_fy,
                    }
                    for b in family_members(f.id)
                ],
            }
            for f in FAMILIES
        ]
        for d in self.decompositions:
            used_years |= {_fiscal_year(d.from_month), _fiscal_year(d.to_month)}
        dim_period = self.tables["dim_period"]
        years = [
            {"id": r.fiscal_year, "status": r.status, "realGdp": float(r.real_gdp), "realCpi": float(r.real_cpi)}
            for r in dim_period.itertuples()
            if r.fiscal_year in used_years
        ]
        caveat_ids = sorted({c for m in METRICS for c in m.caveats} | extra_caveats)
        _json(
            self.root / "meta/catalogue.json",
            {
                "schemaVersion": SCHEMA_VERSION,
                "release": self.release,
                "priceBase": PRICE_BASE,
                "defaultMetric": DEFAULT_METRIC,
                "metrics": metrics,
                "families": families,
                "fiscalYears": years,
                "sources": [
                    {
                        "id": s.id,
                        "publisher": s.publisher,
                        "title": s.title,
                        "url": s.url,
                        "published": s.published or _published(s.cache_source, s.url_match, retrievals),
                        "licence": s.licence,
                    }
                    for s in SOURCES
                ],
                "caveats": [{"id": c, "text": CAVEATS[c]} for c in caveat_ids],
                "models": {
                    "inputs": [
                        {"id": i, "label": label, "period": period, "sources": list(sources)}
                        for i, (label, period, sources) in MODEL_INPUTS.items()
                    ],
                    "expected": {
                        "method": EXPECTED_METHOD,
                        "period": models.PERIOD,
                        "inputs": list(models.INPUT_COLUMNS),
                        "fits": [
                            {
                                "metric": spec.metric,
                                "actualMetric": spec.actual,
                                "denominator": spec.denominator,
                                "levels": {
                                    level: models.describe(self.expected.fits[(spec.metric, level)]) for level in LEVELS
                                },
                            }
                            for spec in models.EXPECTED
                        ],
                    },
                    "neighbours": {
                        "method": NEIGHBOURS_METHOD,
                        "count": neighbours.COUNT,
                        "features": list(neighbours.FEATURES),
                    },
                },
                "conditions": {
                    "month": str(self.tables["fact_pip_condition"].month.iloc[0]),
                    "nations": ["england", "wales"],
                    "sources": ["dwp-stat-xplore"],
                    "groups": self.condition_groups(),
                },
                "decomposition": {
                    "method": DECOMPOSITION_METHOD,
                    "families": [
                        {
                            "family": d.spec.family,
                            "benefit": d.spec.benefit,
                            "claimantUnit": d.spec.claimant_unit,
                            "denominator": d.spec.denominator,
                            "from": d.from_month,
                            "to": d.to_month,
                            "populationPeriods": [f"mid-{y}" for y in d.population_years],
                            "nations": d.nations,
                            "gb": {level: _inputs(d.gb[level]) for level in LEVELS},
                        }
                        for d in self.decompositions
                    ],
                },
            },
        )

    def write_decomposition_bundles(self) -> None:
        for d in self.decompositions:
            for level in LEVELS:
                frame = d.areas[level]
                assert frame.code.tolist() == self.areas[level].code.tolist()

                def pair(name: str, f: pd.DataFrame = frame) -> np.ndarray:
                    return np.stack([f[f"{name}_from"], f[f"{name}_to"]]).astype(np.float32)

                data = bundle.encode(
                    {
                        "kind": "decomposition",
                        "release": self.release,
                        "level": level,
                        "areaCount": len(frame),
                        "areaOrderHash": self.hash[level],
                        "family": d.spec.family,
                        "from": d.from_month,
                        "to": d.to_month,
                    },
                    [
                        ("population", "f32", pair("population")),
                        ("claimants", "f32", pair("claimants")),
                        ("meanWeeklyAward", "f32", pair("award")),
                        ("flags", "u8", frame["flags"].to_numpy(dtype=np.uint8)),
                    ],
                )
                path = self.root / f"decomposition/{level}/{d.spec.family}.bin"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)

    # --------------------------------------------------------------- bundles

    def write_bundles(self) -> None:
        for (metric_id, denominator, level), g in self.values.groupby(["metric", "denominator", "level"]):
            m = METRIC_BY_ID[metric_id]
            periods = self.periods[(metric_id, level)]
            codes = self.areas[level].code
            grid = g.pivot(index="period", columns="code", values="value").reindex(index=periods, columns=codes)
            fgrid = g.pivot(index="period", columns="code", values="flags").reindex(index=periods, columns=codes)
            values = grid.to_numpy(dtype=np.float64)
            flag_values = fgrid.fillna(0).to_numpy(dtype=np.int64)
            common = {
                "release": self.release,
                "level": level,
                "areaCount": len(codes),
                "areaOrderHash": self.hash[level],
            }
            series = bundle.encode(
                {
                    "kind": "series",
                    **common,
                    "metric": metric_id,
                    "denominator": denominator,
                    "unit": m.unit,
                    "rateScale": m.rate_scale,
                    "periodKind": m.period_kind,
                    "periods": periods,
                },
                [("values", "f32", values.astype(np.float32)), ("flags", "u8", flag_values.astype(np.uint8))],
            )
            path = self.root / f"series/{level}/{metric_id}/{denominator}.bin"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(series)

            scale = "log" if m.unit == "ratio" else "linear"
            radius = layout.SWARM_RADIUS[level]
            xy = np.full((len(periods), len(codes), 2), np.nan)
            domains = []
            for p, period in enumerate(periods):
                x, domain = layout.swarm_x(values[p], scale)
                xy[p, :, 0] = x
                xy[p, :, 1] = layout.beeswarm(x, radius, _seed(metric_id, denominator, level, period))
                domains.append([domain[0], domain[1]])
            swarm = bundle.encode(
                {
                    "kind": "swarm",
                    **common,
                    "metric": metric_id,
                    "denominator": denominator,
                    "periodKind": m.period_kind,
                    "periods": periods,
                    "scale": scale,
                    "domains": domains,
                    "radius": radius,
                },
                [("xy", "f32", xy.astype(np.float32))],
            )
            path = self.root / f"layout/{level}/swarm/{metric_id}/{denominator}.bin"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(swarm)

    def write_gb(self, level: str) -> None:
        """GB value and ranked-area count per metric, denominator and period."""
        lvl = self.values[self.values.level == level]
        rank_of = lvl.groupby(["metric", "denominator", "period"]).rank_of.first()
        series = []
        for metric in METRICS:
            for denominator in metric.denominators:
                periods = self.periods.get((metric.id, level), [])
                if not periods:
                    continue
                gb = [self.gb.get((metric.id, denominator, level, p)) for p in periods]
                series.append(
                    {
                        "metric": metric.id,
                        "denominator": denominator,
                        "periodKind": metric.period_kind,
                        "periods": periods,
                        "values": [_round(v, metric, denominator) if v is not None else None for v in gb],
                        "rankOf": [int(rank_of[(metric.id, denominator, p)]) for p in periods],
                    }
                )
        _json(
            self.root / f"meta/gb-{level}.json",
            {"schemaVersion": SCHEMA_VERSION, "release": self.release, "level": level, "series": series},
        )

    def write_geography(self, level: str) -> layout.Shapes:
        """Morph rings, generalised boundaries, map shapes and the map sprite; returns the shapes."""
        doc = json.loads((STAGED / "geo" / f"{level}.geojson").read_text())
        field = "PCON24CD" if level == "constituency" else "LAD23CD"
        geometry = {f["properties"][field]: f["geometry"] for f in doc["features"]}
        codes = self.areas[level].code.tolist()
        rings = np.stack([layout.ring(geometry[c]) for c in codes])
        data = bundle.encode(
            {
                "kind": "rings",
                "release": self.release,
                "level": level,
                "areaCount": len(codes),
                "areaOrderHash": self.hash[level],
                "pointsPerRing": layout.POINTS_PER_RING,
            },
            [("lonLat", "f32", rings.astype(np.float32))],
        )
        path = self.root / f"layout/{level}/rings.bin"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        generalised = [layout.generalise(geometry[c]) for c in codes]
        features = [{"type": "Feature", "properties": {"i": i}, "geometry": g} for i, g in enumerate(generalised)]
        _json(self.root / f"geo/{level}.geojson", {"type": "FeatureCollection", "features": features})

        shapes = layout.build_shapes(generalised)
        bounds = layout.bounds_of(shapes.lon_lat)
        xy, triangles, polygon_triangles = layout.quantise(shapes, bounds)
        data = bundle.encode(
            {
                "kind": "shapes",
                "release": self.release,
                "level": level,
                "areaCount": len(codes),
                "areaOrderHash": self.hash[level],
                "bounds": bounds,
            },
            [
                ("xy", "u16", xy),
                ("rings", "u32", shapes.rings),
                ("polygons", "u32", shapes.polygons),
                ("areas", "u32", shapes.areas),
                ("triangles", "u16", triangles),
                ("polygonTriangles", "u32", polygon_triangles),
            ],
        )
        (self.root / f"layout/{level}/shapes.bin").write_bytes(data)
        (self.root / f"layout/{level}/map.svg").write_text(layout.sprite(shapes, bounds))
        return shapes

    # -------------------------------------------------------------- dossiers

    def write_dossiers(self) -> set[str]:
        t = self.tables
        population = t["fact_population"]
        pop24 = population[population.mid_year == 2024].set_index(["level", "code"])
        overlaps = t["bridge_area_overlap"]
        context = t["fact_context"]
        decile = context[context.indicator == "deprivation-decile"].set_index(["level", "code"])
        representation = t["dim_representation"].set_index("code")
        spend = t["fact_spend_area"]
        names = {(r.level, r.code): (r.name, r.slug) for r in t["dim_area"].itertuples()}
        caveats_used: set[str] = set()
        groups = self.condition_groups()

        latest = {key: periods[-1] for key, periods in self.periods.items()}
        v = self.values
        facts_rows = v[[latest.get((m, lvl)) == p for m, lvl, p in zip(v.metric, v.level, v.period, strict=True)]]
        facts_by_area = dict(tuple(facts_rows.groupby(["level", "code"])))
        defaults = {m.id: m.default_denominator for m in METRICS}
        series_rows = v[v.denominator == v.metric.map(defaults)]
        series_by_area = dict(tuple(series_rows.groupby(["level", "code"])))

        for level in LEVELS:
            lvl_spend = spend[spend.level == level]
            spend_periods = self.periods.get(("spend-total", level), [])
            family_year = spend_periods[-1] if spend_periods else None
            fam = lvl_spend[(lvl_spend.fiscal_year == family_year) & lvl_spend.family.notna()]
            fam_sum = fam.groupby(["code", "family"]).agg(
                value=("value_gbp", "sum"), flags=("flags", lambda s: int(np.bitwise_or.reduce(s.to_numpy())))
            )
            other_level = "local-authority" if level == "constituency" else "constituency"
            col, other_col, share_col = (
                ("constituency", "local_authority", "share_of_constituency")
                if level == "constituency"
                else ("local_authority", "constituency", "share_of_local_authority")
            )
            codes = self.areas[level].code.tolist()
            for a in self.areas[level].itertuples():
                code = a.code
                ov = overlaps[(overlaps[col] == code) & (overlaps[share_col] >= OVERLAP_MIN_SHARE)].sort_values(
                    share_col, ascending=False
                )
                facts = []
                area_facts = facts_by_area.get((level, code), pd.DataFrame())
                for metric_id, g in area_facts.groupby("metric", sort=False):
                    m = METRIC_BY_ID[metric_id]
                    rows = list(g.itertuples())
                    facts.append(
                        {
                            "metric": metric_id,
                            "period": rows[0].period,
                            "denominators": [r.denominator for r in rows],
                            "values": [_round(r.value, m, r.denominator) for r in rows],
                            "flags": [int(r.flags) for r in rows],
                            "ranks": [None if not np.isfinite(r.rank) else int(r.rank) for r in rows],
                        }
                    )
                series = []
                for metric_id, g in series_by_area.get((level, code), pd.DataFrame()).groupby("metric", sort=False):
                    m = METRIC_BY_ID[metric_id]
                    g = g.sort_values("period")
                    series.append(
                        {
                            "metric": metric_id,
                            "denominator": m.default_denominator,
                            "periodKind": m.period_kind,
                            "periods": g.period.tolist(),
                            "values": [_round(v, m, m.default_denominator) for v in g.value],
                            "flags": [int(f) for f in g["flags"]],
                        }
                    )
                items = []
                if family_year is not None and code in fam_sum.index.get_level_values(0):
                    for f in FAMILIES:
                        if (code, f.id) in fam_sum.index:
                            row = fam_sum.loc[(code, f.id)]
                            items.append(
                                {"family": f.id, "value": round(float(row.value), 0), "flags": int(row["flags"])}
                            )
                decomposition = []
                for d in self.decompositions:
                    row = d.areas[level].iloc[a.Index]
                    if np.isfinite(row.population_from):
                        decomposition.append({"family": d.spec.family, **_inputs(row), "flags": int(row["flags"])})
                pop = pop24.loc[(level, code)]
                dep = decile.loc[(level, code)]
                caveats = self._area_caveats(level, code)
                caveats_used |= set(caveats)
                rep = None
                if level == "constituency" and code in representation.index:
                    r = representation.loc[code]
                    rep = {"member": r.member, "party": r.party, "since": r.since}
                dossier = {
                    "schemaVersion": SCHEMA_VERSION,
                    "release": self.release,
                    "level": level,
                    "area": {
                        "code": code,
                        "name": a.name,
                        "slug": a.slug,
                        "nation": a.nation,
                        "region": {"code": a.region_code, "name": a.region_name},
                    },
                    "overlaps": [
                        {
                            "level": other_level,
                            "code": o[other_col],
                            "name": names[(other_level, o[other_col])][0],
                            "slug": names[(other_level, o[other_col])][1],
                            "populationShare": round(float(o[share_col]), 4),
                        }
                        for _, o in ov.iterrows()
                    ],
                    "population": {
                        "period": POPULATION_PERIOD,
                        "total": int(pop.total),
                        "aged0to15": int(pop.aged_0_15),
                        "aged16to64": int(pop.aged_16_64),
                        "aged66plus": int(pop.aged_66_plus),
                    },
                    "facts": facts,
                    "spendByFamily": {"period": family_year, "items": items},
                    "series": series,
                    "decomposition": decomposition,
                    "expected": [
                        {
                            "metric": spec.metric,
                            "actual": _money(row.actual),
                            "expected": _money(row.expected),
                            "residual": _money(row.residual),
                            "flags": int(row["flags"]),
                            "missingInputs": list(row.missing),
                        }
                        for spec in models.EXPECTED
                        for row in [self.expected.areas[(spec.metric, level)].iloc[a.Index]]
                    ],
                    "neighbours": {
                        "missingInputs": self.peers.missing[level][a.Index],
                        "areas": [
                            {
                                "code": codes[j],
                                "name": names[(level, codes[j])][0],
                                "slug": names[(level, codes[j])][1],
                                "distance": round(float(dist), 3),
                            }
                            for j, dist in zip(
                                self.peers.index[level][a.Index], self.peers.distance[level][a.Index], strict=True
                            )
                        ],
                    },
                    "deprivation": {"source": dep.source, "nation": a.nation, "decile": int(dep.value)},
                    "representation": rep,
                    "election": self.area_election(code) if level == "constituency" else None,
                    "conditions": self.area_conditions(level, code, groups),
                    "caveats": caveats,
                }
                _json(self.root / f"area/{level}/{code}.json", dossier)
        return caveats_used

    def _area_caveats(self, level: str, code: str) -> list[str]:
        out = ["deprivation-within-nation", "income-tax-only"]
        if code.startswith("S"):
            out += ["scotland-harmonised", "scotland-agency-modelled", "scotland-caseload-month"]
            if level == "constituency":
                out.append("scotland-apportioned")
        if code in ORKNEY_SHETLAND:
            out.append("orkney-shetland-state-pension")
        out.append("pip-conditions-scotland" if code.startswith("S") else "pip-conditions")
        if level == "constituency":
            out.append("election-2024")
        return out

    # ------------------------------------------------------------ conditions

    def condition_groups(self) -> list[dict[str, Any]]:
        """PIP condition groups, largest first in the England and Wales comparison."""
        t = self.tables["fact_pip_condition"]
        country = t[t.level == "country"].groupby(["condition", "condition_label"], as_index=False).claimants.sum()
        country = country.sort_values(["claimants", "condition"], ascending=[False, True])
        total = float(country.claimants.sum())
        return [
            {
                "id": r.condition,
                "label": r.condition_label,
                "claimants": int(r.claimants),
                "share": round(float(r.claimants) / total, 4),
            }
            for r in country.itertuples()
        ]

    def area_conditions(self, level: str, code: str, groups: list[dict[str, Any]]) -> dict[str, Any] | None:
        t = self.tables["fact_pip_condition"]
        rows = t[(t.level == level) & (t.code == code)].set_index("condition")
        if rows.empty:
            return None
        counts = [rows.claimants.get(g["id"]) for g in groups]
        return {
            "claimants": [None if c is None or not np.isfinite(c) else int(c) for c in counts],
            "flags": [int(rows["flags"].get(g["id"], flags.SUPPRESSED)) for g in groups],
        }

    def area_election(self, code: str) -> dict[str, Any] | None:
        t = self.tables["fact_election_2024"]
        rows = t[t.constituency == code].sort_values("position")
        if rows.empty:
            return None
        first = rows.iloc[0]
        valid = int(first.valid_votes)
        return {
            "date": first.polling_date,
            "electorate": int(first.electorate),
            "validVotes": valid,
            "turnout": round(valid / int(first.electorate), 4),
            "majority": int(first.majority),
            "majorityShare": round(int(first.majority) / valid, 4),
            "candidates": [
                {"party": r.party, "name": r.candidate, "votes": int(r.votes), "share": round(int(r.votes) / valid, 4)}
                for r in rows.itertuples()
            ],
        }

    # -------------------------------------------------------------- downloads

    def write_downloads(self) -> None:
        """Each canonical table as Parquet and CSV. Tables in SPLIT_CSV are too
        large for one CSV, so their CSV splits by level and fiscal year."""
        folder = self.root / "downloads"
        folder.mkdir(parents=True, exist_ok=True)
        con = duckdb.connect()
        for name in TABLES:
            src = self.tables[name]
            con.register("t", src)
            con.execute(f"copy t to '{folder / f'{name}.parquet'}' (format parquet, compression zstd)")
            if name in SPLIT_CSV:
                for (level, year), part in src.groupby(["level", "fiscal_year"]):
                    con.register("p", part)
                    con.execute(f"copy p to '{folder / f'{name}-{level}-{year}.csv'}' (format csv, header true)")
                    con.unregister("p")
            else:
                con.execute(f"copy t to '{folder / f'{name}.csv'}' (format csv, header true)")
            con.unregister("t")
        write_archive(folder, folder / ARCHIVE)

    def write_manifest(self) -> None:
        files = {}
        for path in sorted(self.root.rglob("*")):
            if path.is_file() and path.name != "manifest.json":
                data = path.read_bytes()
                files[path.relative_to(self.root).as_posix()] = {
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
        _json(
            self.root / "manifest.json",
            {
                "schemaVersion": SCHEMA_VERSION,
                "release": self.release,
                "createdAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                "pipelineCommit": _git_commit(),
                "priceBase": PRICE_BASE,
                "levels": {
                    lvl: {
                        "boundarySet": BOUNDARY_SET[lvl],
                        "areaCount": len(self.areas[lvl]),
                        "areaOrderHash": self.hash[lvl],
                    }
                    for lvl in LEVELS
                },
                "coverage": {"nations": ["england", "wales", "scotland"], "notCovered": NOT_COVERED},
                "files": files,
            },
        )


def write_archive(folder: Path, out: Path) -> None:
    """Zip every CSV and Parquet file in `folder` reproducibly: sorted names,
    a fixed timestamp and fixed permissions, so a rebuild has the same hash."""
    with zipfile.ZipFile(out, "w") as archive:
        for path in sorted(folder.iterdir()):
            if path.suffix not in (".csv", ".parquet"):
                continue
            info = zipfile.ZipInfo(path.name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def _published(cache_source: str, url_match: str, retrievals: pd.DataFrame) -> str:
    rows = retrievals[retrievals.source == cache_source]
    if url_match:
        rows = rows[rows.url.str.contains(url_match, regex=True)]
    if rows.empty:
        raise RuntimeError(f"no retrieval recorded for {cache_source} {url_match!r}")
    dates = rows.last_modified.fillna(rows.retrieved)
    return str(dates.max())


def _git_commit() -> str:
    out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    commit = out.stdout.strip()
    assert re.fullmatch(r"[0-9a-f]{40}", commit), commit
    return commit


def write(
    root: Path,
    release: str,
    tables: dict[str, pd.DataFrame],
    values: Values,
    decompositions: list[FamilyDecomposition],
    expected: models.Expected,
    peers: neighbours.Neighbours,
) -> None:
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    r = Release(root, release, tables, values, decompositions, expected, peers)
    for level in LEVELS:
        r.write_areas(level, r.write_geography(level))
    print("  areas and geography written", file=sys.stderr)
    r.write_bundles()
    r.write_decomposition_bundles()
    for level in LEVELS:
        r.write_gb(level)
    print("  bundles written", file=sys.stderr)
    caveats = r.write_dossiers()
    print("  dossiers written", file=sys.stderr)
    r.write_catalogue(pd.read_parquet(staged("retrievals")), caveats)
    r.write_downloads()
    r.write_manifest()
