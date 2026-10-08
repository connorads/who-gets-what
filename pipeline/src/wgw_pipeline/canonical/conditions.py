"""PIP claimants by main disabling condition group, by area and country, at one month.

Stat-Xplore's top-level condition groups ("Disability Category") are kept as
published, with their labels in sentence case; a group with no claimants in
England or Wales is dropped. Stat-Xplore perturbs small cells, and a cell it
withholds is kept empty and flagged suppressed.

Scottish areas and Scotland are left out, as for every devolved benefit's
caseload: DWP's Scottish PIP cases are the few still to move to Adult
Disability Payment, and Social Security Scotland publishes Adult Disability
Payment by condition for Scotland as a whole only, not by area.
"""

from __future__ import annotations

import re

import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.paths import staged

COMPARATOR = ("E92000001", "W92000004")


def condition_id(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def sentence_case(label: str) -> str:
    return label[:1].upper() + label[1:].lower()


def build(dim_area: pd.DataFrame) -> pd.DataFrame:
    known = set(zip(dim_area.level, dim_area.code, strict=True))
    area = pd.read_parquet(staged("pip_conditions_area"))
    area = area[[k in known for k in zip(area.level, area.code, strict=True)]]
    country = pd.read_parquet(staged("pip_conditions_country")).assign(level="country")
    country = country[country.code.isin(COMPARATOR)]
    df = pd.concat([area, country], ignore_index=True)
    df = df[~df.code.str.startswith("S")].copy()
    present = df[df.level == "country"].groupby("category_label").caseload.sum()
    df = df[df.category_label.map(present) > 0]
    df["condition_label"] = df.category_label.map(sentence_case)
    df["condition"] = df.condition_label.map(condition_id)
    df["flags"] = df.caseload.isna().map({True: flags.SUPPRESSED, False: 0}).astype(int)
    df["source"] = "dwp-stat-xplore"
    return df.rename(columns={"caseload": "claimants"})[
        ["level", "code", "month", "condition", "condition_label", "claimants", "flags", "source"]
    ]
