"""Small-area deprivation ranks for each nation's own index.

The English, Welsh and Scottish indices measure different things on different
small areas, so they are never compared across nations.

- England: English Indices of Deprivation 2025 (MHCLG), LSOA 2021 IMD rank.
- Wales: Welsh Index of Multiple Deprivation 2025 (Welsh Government), LSOA 2021
  WIMD rank, from the StatsWales download form.
- Scotland: SIMD 2020 rank of each output area's 2011 data zone, carried in the
  NRS Census 2022 index (see `geography`).
"""

from __future__ import annotations

import io
import re
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache, url_key
from wgw_pipeline.paths import staged

SOURCE = "deprivation"
IOD_FILE7 = "https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv"
WIMD_DATASET = "https://stats.gov.wales/en-GB/9706edd9-73ad-4902-bb12-7ccd7038626e"


def _wimd(cache: RawCache) -> pd.DataFrame:
    url = f"{WIMD_DATASET}/download?view_type=unfiltered&format=csv&view_choice=raw&download_language=en-GB"

    def fetcher() -> tuple[bytes, None]:
        page = cache.request("GET", WIMD_DATASET, timeout=120).text
        start = page.find('/download"')
        form = dict(re.findall(r'name="([^"]+)" value="([^"]*)"', page[start : start + 8000]))
        form.update({"view_type": "unfiltered", "format": "csv", "view_choice": "raw", "download_language": "en-GB"})
        response = cache.request("POST", f"{WIMD_DATASET}/download", data=form, timeout=300)
        if "text/csv" not in response.headers.get("content-type", ""):
            raise RuntimeError("StatsWales did not return CSV for the WIMD 2025 download")
        return response.content, None

    raw = cache.get(SOURCE, url_key(url), url, "csv", fetcher)
    df = pd.read_csv(io.BytesIO(raw.read_bytes()), encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    value, desc, code, domain = df.columns[0], df.columns[1], df.columns[2], df.columns[4]
    overall = df[(df[desc].str.lower() == "rank") & (df[domain].str.upper().isin(["WIMD", "MALLC"]))]
    return pd.DataFrame({"small_area": overall[code], "rank": pd.to_numeric(overall[value]), "index": "wimd-2025"})


def ingest(cache: RawCache) -> None:
    iod = pd.read_csv(cache.fetch(SOURCE, IOD_FILE7, ext="csv").path)
    rank_col = next(c for c in iod.columns if c.startswith("Index of Multiple Deprivation (IMD) Rank"))
    england = pd.DataFrame({"small_area": iod["LSOA code (2021)"], "rank": iod[rank_col], "index": "iod-2025"})
    wales = _wimd(cache)
    out = pd.concat([england, wales], ignore_index=True)
    out.to_parquet(staged("deprivation_small_area"), index=False)
    print(f"  deprivation: {len(england)} English and {len(wales)} Welsh LSOAs", file=sys.stderr)
