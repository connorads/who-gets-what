"""HMRC Survey of Personal Incomes: income and tax by local authority (Table 3.14,
2010-11 to 2023-24) and by 2024 parliamentary constituency (Table 3.15, 2023-24).

SPI is a sample survey: every value carries the survey flag downstream. Cells
HMRC withholds (`[x]`, `*`, `-`) are kept as suppressed, never back-calculated.
Tables before 2017-18 carry names only; their codes are imputed by exact name
from 2017-18 and 2018-19 and marked `code_imputed`. Earlier constituency tables
are on 2010 boundaries and are not used.
"""

from __future__ import annotations

import re
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged
from wgw_pipeline.sheets import Workbook, number

SOURCE = "hmrc-spi"
MEDIA = "https://assets.publishing.service.gov.uk/media"
LA_FILES = {
    "2010-11": f"{MEDIA}/5a7c62f3ed915d6969f44838/table3-14.xls",
    "2011-12": f"{MEDIA}/5a7cca8f40f0b6629523bd53/table3.14-12.xls",
    "2012-13": f"{MEDIA}/5a75b15440f0b67f59fcedf3/Table_3_14_13.xls",
    "2013-14": f"{MEDIA}/5a74c4ece5274a3f93b48aa5/Table_3_14_14.xlsx",
    "2014-15": f"{MEDIA}/5a81e439e5274a2e87dc0074/NS_Table_3_14_1415.xlsx",
    "2015-16": f"{MEDIA}/5ab9424ce5274a1aa2d4176b/NS_Table_3_14_1516.xlsx",
    "2016-17": f"{MEDIA}/5ca1bef440f0b625eb19db4f/NS_Table_3_14_1617.xlsx",
    "2017-18": f"{MEDIA}/5ef49f65e90e075c50609d51/NS_Table_3_14_1718.xlsx",
    "2018-19": f"{MEDIA}/6082ac88e90e076aaaa26e3c/NS_Table_3_14_1819.ods",
    "2019-20": f"{MEDIA}/624d9c7de90e0729f7bd352a/Table_3.14_1920.ods",
    "2020-21": f"{MEDIA}/6402016e8fa8f527f9834d32/Table_3.14_2021.ods",
    "2021-22": f"{MEDIA}/65de1a65f1cab3863afc4701/Table_3.14_2122.ods",
    "2022-23": f"{MEDIA}/67cac1d43f8b61c757f9fffe/Table_3.14_2223.ods",
    "2023-24": f"{MEDIA}/69f215f4b73b862445e3ac61/Table_3.14_2324.ods",
}
PCON_FILES = {"2023-24": f"{MEDIA}/69f21a19b73b862445e3ac72/Table_3.15_2324.ods"}

CODE = re.compile(r"^[EWSNK]\d{8}$")
FIELDS = [
    "se_n_k", "se_mean", "se_median", "emp_n_k", "emp_mean", "emp_median", "pen_n_k", "pen_mean",
    "pen_median", "inc_n_k", "inc_mean", "inc_median", "tax_n_k", "tax_mean", "tax_median",
    "tax_total_m", "basic_rate_n_k", "higher_rate_n_k", "additional_rate_n_k",
]  # fmt: skip
SUPPRESSED = "SUPPRESSED"


def _cell(v: object) -> float | str | None:
    if v is None:
        return None
    n = number(v)
    return SUPPRESSED if n is None else n


def parse(path, year: str) -> pd.DataFrame:
    book = Workbook(path)
    sheet = next(
        s
        for s in book.sheet_names
        if re.search(r"3[._ ]?1[45]", s) and "ote" not in s and "ercent" not in s and "file:" not in s
    )
    d = book.frame(sheet)

    def label(row: pd.Series) -> str | None:
        return next(
            (str(v).strip() for v in row.iloc[:3] if isinstance(v, str) and not CODE.match(v.strip())),
            None,
        )

    labels = d.apply(label, axis=1)
    anchor = labels[labels.eq("North East")].index[0]
    data_cols = [
        c
        for c in d.columns
        if c >= 1
        and isinstance(_cell(d.iat[anchor, c]), float)
        and not (isinstance(d.iat[anchor, c], str) and CODE.match(d.iat[anchor, c]))
    ]
    rows = []
    for i in range(anchor, len(d)):
        r = d.iloc[i]
        name = labels[i]
        code = next((str(v).strip() for v in r.iloc[:2] if isinstance(v, str) and CODE.match(v.strip())), None)
        values = [_cell(r[c]) for c in data_cols]
        if not name or sum(v is not None for v in values) < 8:
            continue
        rec: dict[str, object] = {"tax_year": year, "area_code": code, "area_name": name}
        for key, v in zip(FIELDS, values, strict=False):
            rec[key] = None if v == SUPPRESSED else v
        rec["suppressed_cells"] = sum(v == SUPPRESSED for v in values)
        rec["tax_total_suppressed"] = len(values) > 15 and values[15] == SUPPRESSED
        rows.append(rec)
    return pd.DataFrame(rows)


def ingest(cache: RawCache) -> None:
    frames = []
    for year, url in LA_FILES.items():
        raw = cache.fetch(SOURCE, url, ext=url.rsplit(".", 1)[-1])
        frames.append(parse(raw.path, year))
    la = pd.concat(frames, ignore_index=True)
    names_to_codes = (
        la[la.tax_year.isin(["2017-18", "2018-19"]) & la.area_code.notna()]
        .drop_duplicates("area_name")
        .set_index("area_name")
        .area_code
    )
    la["code_imputed"] = la.area_code.isna() & la.area_name.isin(names_to_codes.index)
    la["area_code"] = la.area_code.fillna(la.area_name.map(names_to_codes))
    la["table"] = "3.14"
    pcon = pd.concat(
        [parse(cache.fetch(SOURCE, url, ext="ods").path, year) for year, url in PCON_FILES.items()],
        ignore_index=True,
    )
    pcon["code_imputed"] = False
    pcon["table"] = "3.15"
    out = pd.concat([la, pcon], ignore_index=True)
    out.to_parquet(staged("hmrc_spi"), index=False)
    print(f"  hmrc spi: {len(la)} LA rows, {len(pcon)} constituency rows", file=sys.stderr)
