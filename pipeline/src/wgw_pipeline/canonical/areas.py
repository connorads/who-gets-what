"""Areas, regions, overlaps between levels, and the population weights that
apportion Scottish council figures to constituencies."""

from __future__ import annotations

import json
import re
import unicodedata

import numpy as np
import pandas as pd

from wgw_pipeline.paths import STAGED, staged

NATION_BY_LETTER = {"E": "england", "W": "wales", "S": "scotland"}
REGION_NAMES = {
    "E12000001": "North East",
    "E12000002": "North West",
    "E12000003": "Yorkshire and The Humber",
    "E12000004": "East Midlands",
    "E12000005": "West Midlands",
    "E12000006": "East of England",
    "E12000007": "London",
    "E12000008": "South East",
    "E12000009": "South West",
    "W92000004": "Wales",
    "S92000003": "Scotland",
}
BOUNDARY_SET = {"constituency": "PCON24", "local-authority": "LAD23"}
NAME_FIELD = {"constituency": ("PCON24CD", "PCON24NM"), "local-authority": ("LAD23CD", "LAD23NM")}


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    ascii_name = ascii_name.replace("&", " and ").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def norm_name(name: str) -> str:
    """Loose name key for matching councils and constituencies published by name."""
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"^(.*), city of$", r"city of \1", s)
    s = s.replace("comhairle nan eilean siar", "na h-eileanan siar")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def build_dim_area() -> pd.DataFrame:
    hexes = pd.read_parquet(staged("hexes"))
    pop = pd.read_parquet(staged("population"))
    frames = []
    for level in ("constituency", "local-authority"):
        doc = json.loads((STAGED / "geo" / f"{level}.geojson").read_text())
        code_field, name_field = NAME_FIELD[level]
        props = pd.DataFrame([f["properties"] for f in doc["features"]])
        props = props[~props[code_field].str.startswith("N")]
        h = hexes[hexes.level == level].set_index("code")
        p = pop[(pop.level == level) & (pop.year == 2024)].set_index("code")
        df = pd.DataFrame(
            {
                "level": level,
                "code": props[code_field],
                "name": props[name_field].str.strip(),
                "boundary_set": BOUNDARY_SET[level],
                "lon": props.LONG.astype(float),
                "lat": props.LAT.astype(float),
                # ONS measures Shape__Area in square metres on the British
                # National Grid, over the boundary clipped to the coastline.
                "area_km2": props.Shape__Area.astype(float) / 1e6,
            }
        )
        df["nation"] = df.code.str[0].map(NATION_BY_LETTER)
        df["region_code"] = df.code.map(h.region)
        df["hex_q"] = df.code.map(h.q)
        df["hex_r"] = df.code.map(h.r)
        df["population"] = df.code.map(p.total)
        missing = df[df[["region_code", "hex_q", "population"]].isna().any(axis=1)]
        assert missing.empty, f"{level}: areas without hex, region or population: {missing.code.tolist()}"
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    out["region_name"] = out.region_code.map(REGION_NAMES)
    out["slug"] = out.name.map(slugify)
    out["hex_q"] = out.hex_q.astype(int)
    out["hex_r"] = out.hex_r.astype(int)
    out["population"] = out.population.astype(int)
    assert out.region_name.notna().all()
    return out.sort_values(["level", "code"]).reset_index(drop=True)


def small_areas() -> pd.DataFrame:
    """Every E&W LSOA and Scottish output area with its constituency, council and population."""
    lookup = pd.read_parquet(staged("small_area_lookup"))
    lsoa_pop = pd.read_parquet(staged("population_lsoa")).set_index("lsoa").population
    ew = lookup.nation != "scotland"
    lookup.loc[ew, "population"] = lookup.loc[ew, "small_area"].map(lsoa_pop)
    assert lookup.population.notna().all(), "small areas without population"
    return lookup


def build_overlaps(areas: pd.DataFrame) -> pd.DataFrame:
    """Population shared by each constituency and council pair, with each side's share."""
    sa = small_areas()
    pairs = sa.groupby(["constituency", "local_authority"], as_index=False).population.sum()
    pairs["share_of_constituency"] = pairs.population / pairs.groupby("constituency").population.transform("sum")
    pairs["share_of_local_authority"] = pairs.population / pairs.groupby("local_authority").population.transform("sum")
    known = set(areas.code)
    assert set(pairs.constituency) <= known and set(pairs.local_authority) <= known, "lookup codes not in dim_area"
    return pairs


def scotland_council_to_seat(overlaps: pd.DataFrame) -> pd.DataFrame:
    """Weights that split a Scottish council figure across constituencies by census population."""
    scot = overlaps[overlaps.local_authority.str.startswith("S")]
    weights = scot[["local_authority", "constituency", "share_of_local_authority"]].rename(
        columns={"share_of_local_authority": "weight"}
    )
    assert np.allclose(weights.groupby("local_authority").weight.sum(), 1.0)
    return weights


def build_deprivation(areas: pd.DataFrame) -> pd.DataFrame:
    """Within-nation deprivation decile (1 = most deprived tenth of the nation's areas).

    Each area's measure is the population-weighted average rank of its small
    areas in its own nation's index, as in the published local authority
    summaries. Areas are then ranked against the other areas of the same nation
    and level.
    """
    sa = small_areas()
    ranks = pd.read_parquet(staged("deprivation_small_area"))
    ew = sa[sa.nation != "scotland"].merge(ranks, on="small_area", how="inner")
    scot = (
        sa[sa.nation == "scotland"].dropna(subset=["simd_rank"]).assign(rank=lambda d: d.simd_rank, index="simd-2020")
    )
    small = pd.concat([ew, scot], ignore_index=True)
    rows = []
    for level, column in (("constituency", "constituency"), ("local-authority", "local_authority")):
        g = small.assign(weighted=small["rank"] * small.population).groupby([column, "nation", "index"], as_index=False)
        agg = g.agg(weighted=("weighted", "sum"), population=("population", "sum"))
        agg["average_rank"] = agg.weighted / agg.population
        agg["decile"] = (
            agg.groupby("nation").average_rank.rank(method="first").sub(1)
            .div(agg.groupby("nation").average_rank.transform("size")).mul(10).floordiv(1).add(1).astype(int)
        )  # fmt: skip
        rows.append(agg.rename(columns={column: "code"}).assign(level=level))
    out = pd.concat(rows, ignore_index=True)[["level", "code", "nation", "index", "average_rank", "decile"]]
    covered = set(zip(out.level, out.code, strict=True))
    missing = [c for c in zip(areas.level, areas.code, strict=True) if c not in covered]
    assert not missing, f"areas without a deprivation measure: {missing[:5]}"
    return out
