"""Mid-year population estimates by single year of age, banded for every denominator.

- Local authorities: ONS/NRS mid-year estimates on April 2023 boundaries, Nomis
  NM_2002_1 (TYPE424), mid-2010 to mid-2025.
- England and Wales constituencies: ONS small area estimates, Nomis NM_2014_1
  (TYPE172, July 2024 boundaries).
- Scottish constituencies: NRS special area estimates (UKPC sheet, 2022 data zones).
- E&W lower layer super output areas (2021), all ages, for population-weighted
  lookups: Nomis NM_2014_1 (TYPE151).
"""

from __future__ import annotations

import io
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache, url_key
from wgw_pipeline.paths import staged
from wgw_pipeline.sheets import Workbook

NOMIS = "https://www.nomisweb.co.uk/api/v01/dataset"
SOURCE_NOMIS = "nomis"
SOURCE_NRS = "nrs"
NRS_SPECIAL_AREAS = (
    "https://www.nrscotland.gov.uk/media/g4ym15ob/special-area-population-tables-mid-2011-to-mid-2024.xlsx"
)

AGES = ",".join(str(a) for a in range(101, 192)) + ",200"  # single years 0..90+, then all ages
SELECT = "GEOGRAPHY_CODE,GEOGRAPHY_NAME,DATE,C_AGE,C_AGE_NAME,OBS_VALUE"
PAGE = 25000

LA_PARAMS = {
    "geography": "TYPE424",
    "date": ",".join(str(y) for y in range(2010, 2026)),
    "gender": 0,
    "c_age": AGES,
    "measures": 20100,
    "select": SELECT,
}
PCON_PARAMS = {
    "geography": "TYPE172",
    "date": ",".join(str(y) for y in range(2018, 2025)),
    "gender": 0,
    "c_age": AGES,
    "measures": 20100,
    "select": SELECT,
}
LSOA_PARAMS = {
    "geography": "TYPE151",
    "date": "2024",
    "gender": 0,
    "c_age": 200,
    "measures": 20100,
    "select": "GEOGRAPHY_CODE,DATE,OBS_VALUE",
}


def nomis_url(dataset: str, params: dict[str, object]) -> str:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{NOMIS}/{dataset}.data.csv?{query}"


def fetch_nomis(cache: RawCache, dataset: str, params: dict[str, object]) -> pd.DataFrame:
    """A Nomis CSV query, paged past the 25,000-row limit and cached as one file."""
    url = nomis_url(dataset, params)

    def fetcher() -> tuple[bytes, None]:
        frames, offset = [], 0
        while True:
            page = cache.request("GET", f"{url}&recordoffset={offset}&recordlimit={PAGE}", timeout=300)
            df = pd.read_csv(io.StringIO(page.text))
            frames.append(df)
            print(f"  nomis {dataset} offset {offset}: {len(df)} rows", file=sys.stderr)
            if len(df) < PAGE:
                break
            offset += PAGE
        return pd.concat(frames, ignore_index=True).to_csv(index=False).encode(), None

    raw = cache.get(SOURCE_NOMIS, url_key(url), url, "csv", fetcher)
    return pd.read_csv(raw.path)


def bands(long: pd.DataFrame) -> pd.DataFrame:
    """Single-year ages (`age` 0..90, 90 = 90 and over) to the denominator bands."""
    keys = ["code", "name", "year"]
    g = long.groupby(keys)

    def band(lo: int, hi: int) -> pd.Series:
        return long[long.age.between(lo, hi)].groupby(keys).pop.sum()

    out = pd.concat(
        [
            g.pop.sum().rename("total"),
            band(0, 15).rename("aged_0_15"),
            band(16, 64).rename("aged_16_64"),
            band(65, 65).rename("aged_65"),
            band(66, 90).rename("aged_66_plus"),
        ],
        axis=1,
    ).reset_index()
    for c in ("total", "aged_0_15", "aged_16_64", "aged_65", "aged_66_plus"):
        out[c] = out[c].round().astype("int64")
    return out


def _nomis_long(df: pd.DataFrame) -> pd.DataFrame:
    single = df[df.C_AGE.between(101, 191)]
    long = pd.DataFrame(
        {
            "code": single.GEOGRAPHY_CODE,
            "name": single.GEOGRAPHY_NAME,
            "year": single.DATE.astype(int),
            "age": single.C_AGE - 101,
            "pop": single.OBS_VALUE,
        }
    )
    totals = df[df.C_AGE == 200].set_index(["GEOGRAPHY_CODE", "DATE"]).OBS_VALUE
    check = long.groupby(["code", "year"]).pop.sum()
    gap = (check - totals.reindex(check.index)).abs().max()
    assert gap < 1, f"single years do not sum to the all-ages total (gap {gap})"
    return long


def scotland_constituencies(cache: RawCache) -> pd.DataFrame:
    raw = cache.fetch(SOURCE_NRS, NRS_SPECIAL_AREAS, ext="xlsx")
    rows = Workbook(raw.path).rows("UKPC")
    header_at = next(i for i, r in enumerate(rows) if r[:4] == ["UKPC (2024) Name", "UKPC (2024) Code", "Sex", "Year"])
    header = [str(c).strip() for c in rows[header_at]]
    df = pd.DataFrame([r for r in rows[header_at + 1 :] if r[1]], columns=header)
    name_col, code_col = "UKPC (2024) Name", "UKPC (2024) Code"
    df = df[df.Sex.astype(str).str.lower() == "persons"]
    age_cols = [c for c in header[5:] if c]
    long = df.melt(id_vars=[name_col, code_col, "Year"], value_vars=age_cols, var_name="age_label", value_name="pop")
    long = pd.DataFrame(
        {
            "code": long[code_col].astype(str),
            "name": long[name_col].astype(str),
            "year": pd.to_numeric(long["Year"]).astype(int),
            "age": long.age_label.astype(str).str.extract(r"(\d+)")[0].astype(int),
            "pop": pd.to_numeric(long["pop"]),
        }
    )
    out = bands(long)
    all_ages = df.set_index([code_col, pd.to_numeric(df["Year"]).astype(int)])["All ages"].astype(float)
    gap = (out.set_index(["code", "year"]).total - all_ages.reindex(out.set_index(["code", "year"]).index)).abs().max()
    assert gap < 1, f"NRS single years do not sum to All ages (gap {gap})"
    return out


def ingest(cache: RawCache) -> None:
    la = bands(_nomis_long(fetch_nomis(cache, "NM_2002_1", LA_PARAMS)))
    la = la[~la.code.str.startswith("N")].assign(level="local-authority", source="ons-population-local-authority")
    ew = bands(_nomis_long(fetch_nomis(cache, "NM_2014_1", PCON_PARAMS)))
    ew = ew.assign(level="constituency", source="ons-population-constituency")
    scot = scotland_constituencies(cache).assign(level="constituency", source="nrs-population-constituency")
    scot = scot[scot.year >= 2018]
    pop = pd.concat([la, ew, scot], ignore_index=True)
    pop.to_parquet(staged("population"), index=False)
    lsoa = fetch_nomis(cache, "NM_2014_1", LSOA_PARAMS)
    pd.DataFrame({"lsoa": lsoa.GEOGRAPHY_CODE, "population": lsoa.OBS_VALUE}).to_parquet(
        staged("population_lsoa"), index=False
    )
    print(
        f"  population: {pop.groupby(['level', 'year']).size().unstack(0).tail(3).to_dict()}; {len(lsoa)} LSOAs",
        file=sys.stderr,
    )
