"""Map historical local authority rows onto the April 2023 councils (LAD23).

Two kinds of change:

- Recodes with no material boundary change: the old code is an alias.
- Mergers of whole districts: a successor's value in a year before it existed is
  the sum of its predecessors. Districts never split, so no value is apportioned.

Name aliases cover HMRC SPI tables before 2017-18, which carry names only.
"""

from __future__ import annotations

import pandas as pd

CODE_ALIASES = {
    "S12000044": "S12000050",  # North Lanarkshire, 2018
    "S12000046": "S12000049",  # Glasgow City, 2018
    "S12000015": "S12000047",  # Fife, 2018
    "S12000024": "S12000048",  # Perth and Kinross, 2018
    "E07000100": "E07000240",  # St Albans, 2018
    "E07000104": "E07000241",  # Welwyn Hatfield, 2018
    "E07000097": "E07000242",  # East Hertfordshire, 2019
    "E07000101": "E07000243",  # Stevenage, 2019
    "E08000020": "E08000037",  # Gateshead, 2013
    "E06000048": "E06000057",  # Northumberland, 2013
}

SUCCESSORS = {
    "E06000058": ("E06000028", "E06000029", "E07000048"),  # Bournemouth, Christchurch and Poole, 2019
    "E06000059": ("E07000049", "E07000050", "E07000051", "E07000052", "E07000053"),  # Dorset, 2019
    "E07000244": ("E07000205", "E07000206"),  # East Suffolk, 2019
    "E07000245": ("E07000201", "E07000204"),  # West Suffolk, 2019
    "E07000246": ("E07000190", "E07000191"),  # Somerset West and Taunton, 2019 (merged into Somerset, 2023)
    "E06000060": ("E07000004", "E07000005", "E07000006", "E07000007"),  # Buckinghamshire, 2020
    "E06000061": ("E07000150", "E07000152", "E07000153", "E07000156"),  # North Northamptonshire, 2021
    "E06000062": ("E07000151", "E07000154", "E07000155"),  # West Northamptonshire, 2021
    "E06000063": ("E07000026", "E07000028", "E07000029"),  # Cumberland, 2023
    "E06000064": ("E07000027", "E07000030", "E07000031"),  # Westmorland and Furness, 2023
    "E06000065": (
        "E07000163",
        "E07000164",
        "E07000165",
        "E07000166",
        "E07000167",
        "E07000168",
        "E07000169",
    ),  # North Yorkshire, 2023
    "E06000066": ("E07000187", "E07000188", "E07000189", "E07000246"),  # Somerset, 2023
}

SPI_NAMES = {
    "Bristol UA": "E06000023",
    "Comhairle nan Eilean Siar": "S12000013",
    "Edinburgh, City of": "S12000036",
    "Herefordshire UA": "E06000019",
    "Kings Lynn and West Norfolk": "E07000146",
    "Kingston upon Hull UA": "E06000010",
    "Kingston-upon-Thames": "E09000021",
    "Medway Towns UA": "E06000035",
    "Newcastle-upon-Tyne": "E08000021",
    "Rhondda, Cynon, Taff": "W06000016",
    "Richmond-upon-Thames": "E09000027",
    "Shepway": "E07000112",
    "South Buckinghamshire": "E07000006",
    "St. Albans": "E07000240",
    "St. Edmundsbury": "E07000204",
    "The Vale of Glamorgan": "W06000014",
}


def _lad23_of(code: str) -> str:
    """Follow merges until a code that is current, e.g. Taunton Deane -> SWT -> Somerset."""
    code = CODE_ALIASES.get(code, code)
    changed = True
    while changed:
        changed = False
        for successor, predecessors in SUCCESSORS.items():
            if code in predecessors:
                code, changed = successor, True
    return code


def to_lad23(df: pd.DataFrame, *, code: str, year: str, values: list[str], keys: list[str]) -> pd.DataFrame:
    """Re-key rows to LAD23 codes, summing predecessors where the current council did not yet exist.

    Where a current council and its predecessors both report a year, the current
    council's own row wins. A sum with any missing part is missing.
    """
    out = df.copy()
    out["source_code"] = out[code]
    out[code] = out[code].map(_lad23_of)
    out["is_own"] = out[code] == out.source_code.map(lambda c: CODE_ALIASES.get(c, c))
    group = [code, year, *keys]
    # An old alias row gives way to a row already published under the current code.
    current = out[out.is_own & (out.source_code == out[code])].set_index(group).index
    out = out[~(out.is_own & (out.source_code != out[code]) & out.set_index(group).index.isin(current))]
    own_years = out[out.is_own].groupby(group).size().index
    merged = out[~out.is_own]
    merged = merged[~merged.set_index(group).index.isin(own_years)]
    agg = merged.groupby(group, dropna=False)[values].agg(lambda s: s.sum(min_count=len(s)))
    own = out[out.is_own].groupby(group, dropna=False)[values].agg(lambda s: s.sum(min_count=len(s)))
    return pd.concat([own, agg]).reset_index()
