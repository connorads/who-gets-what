"""Geography: boundaries, small-area lookups and hex layouts.

- ONS Open Geography Portal: 2024 constituency and May 2023 local authority
  boundaries (BGC, generalised and clipped to the coastline), and the LSOA 2021
  best-fit lookups to 2024 constituencies and 2023 local authorities.
- NRS Census 2022 index: Scottish output areas to council, to 2024 constituency
  (with the SIMD 2020 rank of each output area's 2011 data zone), and output
  area populations. These apportion Scottish council figures to constituencies.
- Open Innovations hexmaps (MIT): `odd-r` hex layouts for 2024 constituencies
  (the 2023 file is identical to the 2024 layout) and 2023 local authorities.
"""

from __future__ import annotations

import io
import json
import sys
import zipfile

import pandas as pd

from wgw_pipeline.cache import RawCache, RawFile
from wgw_pipeline.paths import STAGED, staged

ONS = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
SOURCE_ONS = "ons-geography"
SOURCE_NRS = "nrs-census"
SOURCE_HEX = "hexmaps"

PCON_BOUNDARIES = "Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BGC"
LAD_BOUNDARIES = "Local_Authority_Districts_May_2023_UK_BGC_V2"
LSOA_PCON = "LSOA21_PCON24_LAD21_EW_LU"
LSOA_LAD = "LSOA21_LAD23_EW_LU"

NRS = "https://www.nrscotland.gov.uk/media"
NRS_INDEX = f"{NRS}/utrbt5ze/census_2022_index.zip"
NRS_OA_UKPC = f"{NRS}/njkmhppf/oa22_ukpc24.zip"
NRS_OA_POP = f"{NRS}/owpknvgk/outputarea2022_usualresidentpopulation.csv"

HEXMAPS = "https://raw.githubusercontent.com/odileeds/hexmaps/gh-pages/maps"
HEX_PCON = f"{HEXMAPS}/uk-constituencies-2023.hexjson"
HEX_LAD = f"{HEXMAPS}/uk-local-authority-districts-2023.hexjson"


def arcgis_url(service: str, geometry: bool) -> str:
    kind = "geojson" if geometry else "json"
    return (
        f"{ONS}/{service}/FeatureServer/0/query?where=1%3D1&outFields=*&f={kind}&returnGeometry={str(geometry).lower()}"
    )


def arcgis(cache: RawCache, service: str, *, geometry: bool) -> RawFile:
    """A whole ArcGIS feature layer, paged 1,000 features at a time, cached as one file."""
    url = arcgis_url(service, geometry)

    def fetcher() -> tuple[bytes, None]:
        features: list[object] = []
        offset = 0
        while True:
            params = {"resultOffset": offset, "resultRecordCount": 1000}
            if geometry:
                params["outSR"] = 4326
            response = cache.request("GET", url, params=params, timeout=300)
            page = response.json()
            batch = page["features"]
            features += batch
            offset += len(batch)
            more = page.get("exceededTransferLimit") or page.get("properties", {}).get("exceededTransferLimit")
            print(f"  {service}: {offset} features", file=sys.stderr)
            if not batch or not more:
                break
        body = {"type": "FeatureCollection", "features": features} if geometry else features
        return json.dumps(body).encode(), None

    return cache.get(SOURCE_ONS, service, url, "geojson" if geometry else "json", fetcher)


def _attributes(raw: RawFile) -> pd.DataFrame:
    features = raw.read_json()
    assert isinstance(features, list)
    return pd.DataFrame([f["attributes"] for f in features])


def _zip_csv(raw: RawFile, member_suffix: str) -> pd.DataFrame:
    with zipfile.ZipFile(raw.path) as z:
        name = next(n for n in z.namelist() if n.endswith(member_suffix))
        return pd.read_csv(io.BytesIO(z.read(name)), encoding="utf-8-sig", dtype=str)


def ingest(cache: RawCache) -> None:
    geo_dir = STAGED / "geo"
    geo_dir.mkdir(parents=True, exist_ok=True)
    for level, service in (("constituency", PCON_BOUNDARIES), ("local-authority", LAD_BOUNDARIES)):
        raw = arcgis(cache, service, geometry=True)
        (geo_dir / f"{level}.geojson").write_bytes(raw.read_bytes())

    pcon_lu = _attributes(arcgis(cache, LSOA_PCON, geometry=False))
    lad_lu = _attributes(arcgis(cache, LSOA_LAD, geometry=False))
    lsoa = pcon_lu[["LSOA21CD", "PCON24CD"]].merge(lad_lu[["LSOA21CD", "LAD23CD"]], on="LSOA21CD", how="outer")
    lsoa.columns = ["small_area", "constituency", "local_authority"]
    lsoa["nation"] = lsoa.small_area.str[0].map({"E": "england", "W": "wales"})

    index = _zip_csv(cache.fetch(SOURCE_NRS, NRS_INDEX, ext="zip"), "OA_TO_HIGHER_AREAS.csv")
    ukpc = _zip_csv(cache.fetch(SOURCE_NRS, NRS_OA_UKPC, ext="zip"), "OA22_UKPC24.csv")
    oa_pop = pd.read_csv(cache.fetch(SOURCE_NRS, NRS_OA_POP, ext="csv").path, dtype={"OutputArea2022": str})
    scot = (
        index[["OA2022", "CA2019", "SIMD2020"]]
        .merge(ukpc[["OA22", "UKPC24"]], left_on="OA2022", right_on="OA22")
        .merge(oa_pop, left_on="OA2022", right_on="OutputArea2022")
    )
    scot = pd.DataFrame(
        {
            "small_area": scot.OA2022,
            "constituency": scot.UKPC24,
            "local_authority": scot.CA2019,
            "nation": "scotland",
            "population": pd.to_numeric(scot.UsualResidentPopulation),
            "simd_rank": pd.to_numeric(scot.SIMD2020, errors="coerce"),
        }
    )
    pd.concat([lsoa, scot], ignore_index=True).to_parquet(staged("small_area_lookup"), index=False)

    hexes = []
    for level, url in (("constituency", HEX_PCON), ("local-authority", HEX_LAD)):
        doc = cache.fetch(SOURCE_HEX, url, ext="hexjson").read_json()
        assert isinstance(doc, dict) and doc["layout"] == "odd-r"
        for code, h in doc["hexes"].items():
            hexes.append(
                {"level": level, "code": code, "name": h["n"], "q": h["q"], "r": h["r"], "region": h.get("region")}
            )
    pd.DataFrame(hexes).to_parquet(staged("hexes"), index=False)
    print(f"  geography: {len(lsoa)} LSOAs, {len(scot)} Scottish output areas, {len(hexes)} hexes", file=sys.stderr)
