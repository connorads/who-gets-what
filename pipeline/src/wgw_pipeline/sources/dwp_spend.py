"""DWP benefit expenditure by local authority and by parliamentary constituency (ODS).

Canonical values come from the per-benefit sheets, which carry sub-splits such
as PIP under and over 65. Year sheets supply the published TOTAL and any cell
the benefit sheets lack. The published TOTAL is kept for audit only: it is
wrong in several years (LA 2020-21 omits UC), so totals are always rebuilt from
top-level benefit rows downstream.

Rows join on GSS code, never on name: some year sheets carry corrupted names
(2021-22 "BrABknell Forest"). Constituency sheets hold two boundary sets:
plain sheets are PCON2010 (2010-11 to 2022-23) and `_PC24` sheets are PCON2024
(2018-19 on). They overlap and share some Scottish codes, so `boundary` is
always carried and the two are never summed or joined.
"""

from __future__ import annotations

import re
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache, RawFile
from wgw_pipeline.paths import staged
from wgw_pipeline.sheets import Workbook, number

SOURCE = "dwp-spend"
LA_URL = "https://assets.publishing.service.gov.uk/media/693ffb536a12691d48491fb3/benefit-expenditure-by-local-authority-2024-25.ods"
PCON_URL = "https://assets.publishing.service.gov.uk/media/693ffc50c72b0f8ccf33d788/benefit-expenditure-by-parliamentary-constituency-2024-25.ods"

YEAR_RE = re.compile(r"^(\d{4})/(\d{2})$")

# benefit code -> (name, parent, age group)
BENEFITS: dict[str, tuple[str, str | None, str]] = {
    "TOTAL": ("Total DWP benefits covered (as published)", None, "all"),
    "AA": ("Attendance Allowance", None, "pension_age"),
    "BB": ("Bereavement Benefit / Widow's Benefit", None, "working_age"),
    "CTB": ("Council Tax Benefit", None, "all"),
    "CA": ("Carer's Allowance", None, "working_age"),
    "DLA": ("Disability Living Allowance", None, "all"),
    "DLA_CHILD": ("Disability Living Allowance - children", "DLA", "children"),
    "DLA_WA": ("Disability Living Allowance - working age", "DLA", "working_age"),
    "DLA_PA": ("Disability Living Allowance - pension age", "DLA", "pension_age"),
    "DHP": ("Discretionary Housing Payments", None, "all"),
    "ESA": ("Employment and Support Allowance", None, "working_age"),
    "IB": ("Incapacity Benefit", None, "working_age"),
    "IS": ("Income Support", None, "working_age"),
    "IS_MIG": ("Income Support - Minimum Income Guarantee", "IS", "pension_age"),
    "IS_INCAP": ("Income Support - incapacity", "IS", "working_age"),
    "IS_CARER": ("Income Support - carer", "IS", "working_age"),
    "IS_LP": ("Income Support - lone parent", "IS", "working_age"),
    "IS_OTHER": ("Income Support - others", "IS", "working_age"),
    "JSA": ("Jobseeker's Allowance", None, "working_age"),
    "PC": ("Pension Credit", None, "pension_age"),
    "PIP": ("Personal Independence Payment", None, "all"),
    "PIP_U65": ("Personal Independence Payment - under 65", "PIP", "working_age"),
    "PIP_65PLUS": ("Personal Independence Payment - 65 and over", "PIP", "pension_age"),
    "HB": ("Housing Benefit", None, "all"),
    "SDA": ("Severe Disablement Allowance", None, "all"),
    "SDA_WA": ("Severe Disablement Allowance - working age", "SDA", "working_age"),
    "SDA_PA": ("Severe Disablement Allowance - pension age", "SDA", "pension_age"),
    "SP": ("State Pension", None, "pension_age"),
    "UC": ("Universal Credit", None, "working_age"),
    "WFP": ("Winter Fuel Payment", None, "pension_age"),
}

LA_SHEETS = {
    "AA": "AA", "BB": "BB", "CTB": "CTB", "CA": "CA", "DLA_(total)": "DLA",
    "DLA_(children)": "DLA_CHILD", "DLA_(working_age)": "DLA_WA", "DLA_(pensioners)": "DLA_PA",
    "DHP": "DHP", "ESA": "ESA", "IB": "IB", "IS": "IS", "IS_(MIG)": "IS_MIG",
    "IS_(incapacity)": "IS_INCAP", "IS_(carer)": "IS_CARER", "IS_(lone_parent)": "IS_LP",
    "IS_(others)": "IS_OTHER", "JSA": "JSA", "PC": "PC", "PIP": "PIP", "PIP_(under_65)": "PIP_U65",
    "PIP_(65_and_over)": "PIP_65PLUS", "HB": "HB", "SDA": "SDA", "SDA_(working_age)": "SDA_WA",
    "SDA_(pensioners)": "SDA_PA", "SP": "SP", "UC": "UC", "WFP": "WFP",
}  # fmt: skip

# Plain sheets are PCON2010 series; `_PC24` sheets are PCON2024 series.
PCON_SHEETS = {
    "AA": "AA", "AA_(PC24)": "AA", "BB": "BB", "BB_(PC24)": "BB", "CA": "CA", "CA_(PC24)": "CA",
    "DLA_(total)": "DLA", "DLA_(Total_PC24)": "DLA", "DLA_(children)": "DLA_CHILD",
    "DLA_(Children_PC24)": "DLA_CHILD", "DLA_(working_age)": "DLA_WA", "DLA_(Working_Age_PC24)": "DLA_WA",
    "DLA_(pension_age)": "DLA_PA", "DLA_(Pension_Age_PC24)": "DLA_PA", "ESA": "ESA", "ESA_(PC24)": "ESA",
    "HB": "HB", "HB_(PC24)": "HB", "IB": "IB", "IS": "IS", "IS_(PC24)": "IS", "IS_(incapacity)": "IS_INCAP",
    "IS_(LP)": "IS_LP", "IS_(LP_PC24)": "IS_LP", "IS_(carer)": "IS_CARER", "IS_(Carer_PC24)": "IS_CARER",
    "IS_(others)": "IS_OTHER", "IS_(Others_PC24)": "IS_OTHER", "JSA": "JSA", "JSA_(PC24)": "JSA",
    "PC": "PC", "PC_(PC24)": "PC", "PIP": "PIP", "PIP_(PC24)": "PIP", "PIP_(under_65)": "PIP_U65",
    "PIP_(65_and_over)": "PIP_65PLUS", "SDA": "SDA", "SDA_(PC24)": "SDA", "SDA_(working_age)": "SDA_WA",
    "SDA_(pension_age)": "SDA_PA", "SDA_(Pension_Age_PC24)": "SDA_PA", "SP": "SP", "SP_(PC24)": "SP",
    "UC": "UC", "UC_(PC24)": "UC", "WFP": "WFP", "WFP_(PC24)": "WFP",
}  # fmt: skip

# Year-sheet column headers; "of which" columns resolve against the last parent seen.
TOP_COLS = {
    "Total": "TOTAL", "Attendance Allowance": "AA", "Bereavement Benefit/Widow's Benefit": "BB",
    "Carer's Allowance": "CA", "Council Tax Benefit": "CTB", "Disability Living Allowance": "DLA",
    "Discretionary Housing Payments": "DHP", "Employment And Support Allowance": "ESA",
    "Housing Benefit": "HB", "Incapacity Benefit": "IB", "Income Support": "IS",
    "Jobseeker's Allowance": "JSA", "Pension Credit": "PC", "Personal Independence Payment": "PIP",
    "Severe Disablement Allowance": "SDA", "State Pension": "SP", "Universal Credit": "UC",
    "Winter Fuel Payments": "WFP",
}  # fmt: skip
SUB_COLS = {
    ("DLA", "of which children"): "DLA_CHILD", ("DLA", "of which working age"): "DLA_WA",
    ("DLA", "of which pensioners"): "DLA_PA", ("IS", "of which incapacity benefits"): "IS_INCAP",
    ("IS", "of which Lone Parent"): "IS_LP", ("IS", "of which Carer"): "IS_CARER",
    ("IS", "of which Others"): "IS_OTHER", ("IS", "of which Minimum Income Guarantee"): "IS_MIG",
    ("SDA", "of which working age"): "SDA_WA", ("SDA", "of which pensioners"): "SDA_PA",
    ("PIP", "of which Under 65"): "PIP_U65", ("PIP", "of which 65 and over"): "PIP_65PLUS",
}  # fmt: skip

# First fiscal year (start) in which Scottish spend is outside the DWP tables
# because the benefit is devolved. Carer's Allowance devolved on 3 September
# 2018, so 2018-19 is part-year GB.
DEVOLVED_FROM = {
    "CA": 2018, "DLA": 2020, "DLA_CHILD": 2020, "DLA_WA": 2020, "DLA_PA": 2020, "PIP": 2020,
    "PIP_U65": 2020, "PIP_65PLUS": 2020, "AA": 2020, "SDA": 2020, "SDA_WA": 2020, "SDA_PA": 2020,
    "WFP": 2024, "DHP": 2017,
}  # fmt: skip

REGIONS = {
    "GREAT BRITAIN": ("K03000001", "country"), "NORTH EAST ENGLAND": ("E12000001", "region"),
    "NORTH WEST ENGLAND": ("E12000002", "region"), "YORKSHIRE AND THE HUMBER": ("E12000003", "region"),
    "EAST MIDLANDS": ("E12000004", "region"), "WEST MIDLANDS": ("E12000005", "region"),
    "EAST ENGLAND": ("E12000006", "region"), "LONDON": ("E12000007", "region"),
    "SOUTH EAST ENGLAND": ("E12000008", "region"), "SOUTH WEST ENGLAND": ("E12000009", "region"),
    "WALES": ("W92000004", "country"), "SCOTLAND": ("S92000003", "country"),
}  # fmt: skip

LEVEL_BY_PREFIX = {
    "K03": "country", "E92": "country", "W92": "country", "S92": "country",
    "E14": "pcon", "W07": "pcon", "S14": "pcon",
}  # fmt: skip


def _fy(label: str) -> str:
    m = YEAR_RE.match(label)
    if m is None:
        raise ValueError(f"not a fiscal year label: {label!r}")
    return f"{m.group(1)}-{m.group(2)}"


def _header_row(df: pd.DataFrame) -> int:
    for i in range(min(8, len(df))):
        if str(df.iat[i, 0]).strip() in ("Area Code", "PC Code"):
            return i
    raise ValueError("no header row")


def _area_rows(df: pd.DataFrame, header: int, name_col: int) -> list[tuple[str | None, str, str, pd.Series]]:
    """Data rows with GSS code, name and level, repairing displaced country-row values.

    Some country rows carry no values and the next, unlabelled, row holds them.
    """
    body = df.iloc[header + 1 :].reset_index(drop=True).copy()
    values = body.columns[name_col + 1 :]
    for i in range(len(body) - 1):
        row, nxt = body.iloc[i], body.iloc[i + 1]
        if (
            pd.notna(row[0])
            and row[values].isna().all()
            and pd.isna(nxt[0])
            and pd.isna(nxt[name_col])
            and nxt[values].notna().any()
        ):
            body.loc[i, values] = nxt[values].to_numpy()
            body.loc[i + 1, values] = None
    body = body[body[0].notna() | body[name_col].notna()]
    out = []
    for _, r in body.iterrows():
        code = None if pd.isna(r[0]) else str(r[0]).strip()
        name = str(r[name_col]).strip()
        if code:
            gss, level = code, LEVEL_BY_PREFIX.get(code[:3], "la")
        elif name.upper().startswith("OF WHICH CLAIMANTS"):
            gss, level = None, "abroad_or_unknown"
        elif name.upper() in REGIONS:
            gss, level = REGIONS[name.upper()]
        else:
            gss, level = None, "county_aggregate"
        out.append((gss, name, level, r))
    return out


def _benefit_sheet(book: Workbook, sheet: str, code: str, name_col: int, boundary: str | None) -> list[dict]:
    df = book.frame(sheet)
    header = _header_row(df)
    year_cols = [(j, str(h).strip()) for j, h in enumerate(df.iloc[header]) if YEAR_RE.match(str(h).strip())]
    records = []
    for gss, name, level, r in _area_rows(df, header, name_col):
        for j, label in year_cols:
            v = number(r[j])
            if v is None:
                continue
            records.append(
                dict(gss=gss, name=name, area_level=level, benefit_code=code, fiscal_year=_fy(label),
                     spend_gbp_m=v, boundary=boundary, source_sheet=sheet)
            )  # fmt: skip
    return records


def _year_sheet(book: Workbook, sheet: str, name_col: int, boundary: str | None) -> list[dict]:
    df = book.frame(sheet)
    header = _header_row(df)
    heads = [str(h).strip() for h in df.iloc[header]]
    cols, parent = [], None
    for j, h in enumerate(heads):
        if j <= name_col:
            continue
        if h in TOP_COLS:
            parent = TOP_COLS[h]
            cols.append((j, parent))
        elif (parent, h) in SUB_COLS:
            cols.append((j, SUB_COLS[(parent, h)]))
        elif h not in ("None", "nan", ""):
            raise ValueError(f"{sheet}: unknown column {h!r} after {parent}")
    year = _fy(sheet.replace("-", "/"))
    records = []
    for gss, name, level, r in _area_rows(df, header, name_col):
        for j, code in cols:
            v = number(r[j])
            if v is None:
                continue
            records.append(
                dict(gss=gss, name=name, area_level=level, benefit_code=code, fiscal_year=year,
                     spend_gbp_m=v, boundary=boundary, source_sheet=sheet)
            )  # fmt: skip
    return records


def _merge(benefit_rows: list[dict], year_rows: list[dict], key: list[str]) -> pd.DataFrame:
    """Union benefit-sheet and year-sheet cells; benefit sheets win where both exist."""
    b = pd.DataFrame(benefit_rows)
    y = pd.DataFrame(year_rows)
    for d in (b, y):
        d["akey"] = d.gss.where(d.gss.notna(), d.name.str.strip().str.upper())
    k = [c for c in key if c not in ("gss", "name")] + ["akey"]
    both = b.merge(y.drop(columns=["gss", "name", "area_level", "source_sheet"]), on=k, suffixes=("", "_y"))
    diff = (both.spend_gbp_m - both.spend_gbp_m_y).abs()
    mismatches = both[diff > 1e-6 * both.spend_gbp_m.abs().clip(lower=1)]
    print(f"  overlap cells {len(both)}, mismatches {len(mismatches)}", file=sys.stderr)
    extra = y.merge(b[k], on=k, how="left", indicator=True)
    extra = extra[extra._merge == "left_only"].drop(columns="_merge")
    # A zero only the year sheet carries marks a benefit not in payment (PIP before
    # 2013) or an unpublished year (PCON HB 2010-11): drop it rather than report a 0.
    extra = extra[(extra.benefit_code == "TOTAL") | (extra.spend_gbp_m != 0)]
    out = pd.concat([b, extra], ignore_index=True)
    names = pd.concat([b, y.sort_values("fiscal_year", ascending=False)]).drop_duplicates("akey").set_index("akey").name
    out["name"] = out.akey.map(names).str.strip()
    return out.drop(columns="akey")


def _finish(df: pd.DataFrame) -> pd.DataFrame:
    df["benefit_parent"] = df.benefit_code.map(lambda c: BENEFITS[c][1])
    df["age_group"] = df.benefit_code.map(lambda c: BENEFITS[c][2])
    start = df.fiscal_year.str[:4].astype(int)
    devolved_from = df.benefit_code.map(DEVOLVED_FROM)
    devolved = devolved_from.notna() & (start >= devolved_from)
    is_scot = df.gss.fillna("").str.startswith("S") | (df.name.str.upper() == "SCOTLAND")
    part_year_ca = (df.benefit_code == "CA") & (start == 2018)
    # Scottish areas show 0 once a benefit is devolved; a 0 would read as "no spend".
    df["scotland_devolved"] = is_scot & devolved & ~part_year_ca
    df.loc[df.scotland_devolved, "spend_gbp_m"] = None
    return df


def parse_la(path: RawFile) -> pd.DataFrame:
    book = Workbook(path.path)
    benefit_rows = [r for s, c in LA_SHEETS.items() for r in _benefit_sheet(book, s, c, 1, None)]
    year_rows = [r for s in book.sheet_names if re.match(r"^\d{4}-\d{2}$", s) for r in _year_sheet(book, s, 1, None)]
    df = _merge(benefit_rows, year_rows, ["gss", "name", "benefit_code", "fiscal_year"])
    # Drop LA-years where the LA did not exist (districts after reorganisation, new UAs before).
    totals = df[(df.benefit_code == "TOTAL") & (df.area_level == "la")]
    assert not totals.duplicated(["gss", "fiscal_year"]).any()
    live = set(map(tuple, totals[totals.spend_gbp_m > 0][["gss", "fiscal_year"]].to_numpy()))
    exists = (df.area_level != "la") | pd.Series(
        [k in live for k in zip(df.gss, df.fiscal_year, strict=True)], index=df.index
    )
    df = df[exists].drop(columns="boundary")
    return _finish(df).sort_values(["area_level", "gss", "benefit_code", "fiscal_year"]).reset_index(drop=True)


def parse_pcon(path: RawFile) -> pd.DataFrame:
    book = Workbook(path.path)
    benefit_rows = [
        r
        for s, c in PCON_SHEETS.items()
        for r in _benefit_sheet(book, s, c, 2, "PCON2024" if "PC24" in s else "PCON2010")
    ]
    year_rows = [
        r
        for s in book.sheet_names
        if re.match(r"^\d{4}-\d{2}$", s)
        for r in _year_sheet(book, s, 2, "PCON2024" if int(s[:4]) >= 2023 else "PCON2010")
    ]
    df = _merge(benefit_rows, year_rows, ["boundary", "gss", "name", "benefit_code", "fiscal_year"])
    # 2024 English codes are E14001063 and above; 2010 codes are E14000530 to E14001062.
    english = df[(df.area_level == "pcon") & df.gss.fillna("").str.startswith("E14")]
    n = english.gss.str[3:].astype(int)
    wrong = english[((english.boundary == "PCON2024") & (n < 1063)) | ((english.boundary == "PCON2010") & (n >= 1063))]
    assert wrong.empty, wrong.head()
    return (
        _finish(df).sort_values(["boundary", "area_level", "gss", "benefit_code", "fiscal_year"]).reset_index(drop=True)
    )


def ingest(cache: RawCache) -> None:
    la = parse_la(cache.fetch(SOURCE, LA_URL, ext="ods"))
    la.to_parquet(staged("dwp_spend_la"), index=False)
    pcon = parse_pcon(cache.fetch(SOURCE, PCON_URL, ext="ods"))
    pcon.to_parquet(staged("dwp_spend_pcon"), index=False)
    print(f"  dwp spend: {len(la)} LA rows, {len(pcon)} constituency rows", file=sys.stderr)
