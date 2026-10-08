"""Seed the raw cache from an earlier exploration download, so a first run does
not refetch files that are already on disk.

A file is copied only when it is the same file: for plain downloads the
server's Content-Length must equal the local size. API results with no stable
length (Stat-Xplore, Nomis, ArcGIS, Members API) are copied when their request
is reproduced exactly; Stat-Xplore files are already keyed by their request.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

from wgw_pipeline.cache import RawCache, url_key
from wgw_pipeline.sources import (
    deprivation,
    dwp_outturn,
    dwp_spend,
    geography,
    hmrc_spi,
    parliament,
    population,
    prices,
    sss,
    statxplore,
)


@dataclass(frozen=True)
class Seed:
    source: str
    key: str
    url: str
    local: str
    ext: str
    verify_length: bool = True


def _seeds() -> list[Seed]:
    spi_local = {
        "2010-11": "t314_1011.xls", "2011-12": "t314_1112.xls", "2012-13": "t314_1213.xls",
        "2013-14": "t314_1314.xlsx", "2014-15": "t314_1415.xlsx", "2015-16": "t314_1516.xlsx",
        "2016-17": "t314_1617.xlsx", "2017-18": "t314_1718.xlsx", "2018-19": "t314_1819.ods",
        "2019-20": "t314_1920.ods", "2020-21": "t314_2021.ods", "2021-22": "t314_2122.ods",
        "2022-23": "t314_2223.ods", "2023-24": "t314_2324.ods",
    }  # fmt: skip
    seeds = [
        Seed(dwp_spend.SOURCE, url_key(dwp_spend.LA_URL), dwp_spend.LA_URL, "explore/raw/spend_la_2024-25.ods", "ods"),
        Seed(
            dwp_spend.SOURCE,
            url_key(dwp_spend.PCON_URL),
            dwp_spend.PCON_URL,
            "explore/raw/spend_pcon_2024-25.ods",
            "ods",
        ),
        Seed(
            dwp_outturn.SOURCE,
            url_key(dwp_outturn.URL),
            dwp_outturn.URL,
            "explore/raw/outturn_forecast_spring_2026.ods",
            "ods",
        ),
        Seed(
            population.SOURCE_NRS,
            url_key(population.NRS_SPECIAL_AREAS),
            population.NRS_SPECIAL_AREAS,
            "explore/raw/nrs/special-area-2011-2024.xlsx",
            "xlsx",
        ),
        Seed(geography.SOURCE_HEX, url_key(geography.HEX_PCON), geography.HEX_PCON, "c23.hexjson", "hexjson"),
        Seed(
            deprivation.SOURCE,
            url_key(deprivation.IOD_FILE7),
            deprivation.IOD_FILE7,
            "explore/raw/imd/File_7_IoD2025_all.csv",
            "csv",
        ),
        Seed(sss.SOURCE, url_key(sss.URLS["ADP"]), sss.URLS["ADP"], "adp.xlsx", "xlsx"),
        Seed(sss.SOURCE, url_key(sss.URLS["PADP"]), sss.URLS["PADP"], "padp.xlsx", "xlsx"),
        Seed(sss.SOURCE, url_key(sss.URLS["CSP"]), sss.URLS["CSP"], "csp.xlsx", "xlsx"),
        Seed(sss.SOURCE, url_key(sss.URLS["PAWHP"]), sss.URLS["PAWHP"], "pawhp.xlsx", "xlsx"),
        Seed(
            prices.SOURCE,
            url_key(prices.CPI_D7BT),
            prices.CPI_D7BT,
            "explore/raw/ons_d7bt.csv",
            "csv",
            verify_length=False,
        ),
        Seed(
            parliament.SOURCE,
            "members-current",
            parliament.MEMBERS,
            "explore/raw/elections/members_current.json",
            "json",
            verify_length=False,
        ),
        Seed(
            population.SOURCE_NOMIS,
            url_key(population.nomis_url("NM_2002_1", population.LA_PARAMS)),
            population.nomis_url("NM_2002_1", population.LA_PARAMS),
            "explore/raw/nomis/nm2002_type424_2010_2025.csv",
            "csv",
            verify_length=False,
        ),
        Seed(
            geography.SOURCE_ONS,
            geography.PCON_BOUNDARIES,
            geography.arcgis_url(geography.PCON_BOUNDARIES, True),
            "explore/raw/geo/pcon_2024_uk_bgc.geojson",
            "geojson",
            verify_length=False,
        ),
        Seed(
            geography.SOURCE_ONS,
            geography.LSOA_PCON,
            geography.arcgis_url(geography.LSOA_PCON, False),
            "explore/raw/geo/LSOA21_PCON24_LAD21_EW_LU.json",
            "json",
            verify_length=False,
        ),
    ]
    for year, url in hmrc_spi.LA_FILES.items():
        seeds.append(
            Seed(hmrc_spi.SOURCE, url_key(url), url, f"explore/raw/spi/{spi_local[year]}", url.rsplit(".", 1)[-1])
        )
    url = hmrc_spi.PCON_FILES["2023-24"]
    seeds.append(Seed(hmrc_spi.SOURCE, url_key(url), url, "explore/raw/spi/t315_2324.ods", "ods"))
    return seeds


def seed(cache: RawCache, root: Path) -> None:
    copied = skipped = 0
    for s in _seeds():
        local = root / s.local
        if not local.exists() or cache.latest(s.source, s.key) is not None:
            continue
        last_modified = None
        if s.verify_length:
            try:
                head = cache.session.head(s.url, allow_redirects=True, timeout=60)
            except requests.RequestException:
                skipped += 1
                continue
            length = head.headers.get("Content-Length")
            if head.status_code != 200 or length is None or int(length) != local.stat().st_size:
                print(f"  seed skipped (differs from server): {s.local}", file=sys.stderr)
                skipped += 1
                continue
            if lm := head.headers.get("Last-Modified"):
                last_modified = parsedate_to_datetime(lm).date()
        cache.seed(s.source, s.key, s.url, local, s.ext, last_modified=last_modified)
        copied += 1
    sx_dir = root / "explore/raw/sx"
    sx_copied = 0
    if sx_dir.is_dir():
        for f in sorted(sx_dir.glob("*.json")):
            if cache.latest(statxplore.SOURCE, f.stem) is None:
                cache.seed(statxplore.SOURCE, f.stem, statxplore.BASE, f, "json")
                sx_copied += 1
    print(f"  seeded {copied} files and {sx_copied} Stat-Xplore responses; {skipped} skipped", file=sys.stderr)
