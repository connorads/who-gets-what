"""Build every canonical table from staged Parquet and write it with DuckDB."""

from __future__ import annotations

import sys

import duckdb
import pandas as pd

from wgw_pipeline.canonical import areas as area_mod
from wgw_pipeline.canonical import benefits, caseload, conditions, elections, periods, scotland, spend, tax
from wgw_pipeline.canonical.areas import norm_name
from wgw_pipeline.paths import CANONICAL, canonical, staged

TABLES = (
    "dim_area",
    "dim_benefit",
    "dim_period",
    "fact_spend_area",
    "fact_caseload_area",
    "fact_population",
    "fact_tax_area",
    "fact_context",
    "bridge_area_overlap",
    "dim_representation",
    "fact_election_2024",
    "fact_pip_condition",
)


def _write(con: duckdb.DuckDBPyConnection, name: str, df: pd.DataFrame, order: str) -> None:
    con.register("frame", df)
    con.execute(f"copy (select * from frame order by {order}) to '{canonical(name)}' (format parquet)")
    con.unregister("frame")


def run() -> dict[str, pd.DataFrame]:
    CANONICAL.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()

    dim_area = area_mod.build_dim_area()
    overlaps = area_mod.build_overlaps(dim_area)
    weights = area_mod.scotland_council_to_seat(overlaps)

    dim_benefit = pd.DataFrame(
        [
            {
                "code": b.code,
                "label": b.label,
                "family": b.family,
                "parent_code": b.parent,
                "administrator": b.administrator,
                "nations": list(b.nations),
                "from_fy": b.from_fy,
                "to_fy": b.to_fy,
                "devolved_from_fy": periods.fiscal_year(b.devolved_from) if b.devolved_from else None,
            }
            for b in benefits.BENEFITS
        ]
    )
    dim_period = periods.build_dim_period()

    pop = pd.read_parquet(staged("population"))
    fact_population = pop.rename(columns={"year": "mid_year"})[
        ["level", "code", "mid_year", "total", "aged_0_15", "aged_16_64", "aged_66_plus", "source"]
    ]

    measured = spend.measured(dim_area)
    last_fy = measured[measured.level == "local-authority"].fiscal_year.max()
    agency, checks = scotland.agency_model(measured, last_fy)
    sss_rows = scotland.sss_spend(measured, dim_area, last_fy)
    council = pd.concat([agency, sss_rows], ignore_index=True).assign(level="local-authority")
    seat_rows = scotland.to_constituencies(
        council[["code", "fiscal_year", "benefit_code", "value_gbp", "flags", "method", "source"]], weights, "value_gbp"
    ).assign(level="constituency", method="apportioned")
    estimated = pd.concat([council, seat_rows], ignore_index=True)
    estimated["family"] = estimated.benefit_code.map(lambda c: benefits.BY_CODE[c].family)
    fact_spend = pd.concat([measured, estimated[measured.columns]], ignore_index=True)
    # Sources publish £ million to many decimal places; whole pounds keep every total exact enough.
    fact_spend["value_gbp"] = fact_spend.value_gbp.round(0)

    fact_caseload, residual = caseload.build(dim_area, weights)
    fact_tax = tax.build(dim_area)

    deprivation = area_mod.build_deprivation(dim_area)
    context = [
        deprivation.assign(indicator="deprivation-decile", period=deprivation["index"], value=deprivation.decile),
        deprivation.assign(
            indicator="deprivation-average-rank", period=deprivation["index"], value=deprivation.average_rank
        ),
    ]
    pawhp = scotland._with_codes(pd.read_parquet(staged("sss_pawhp_council")), scotland.council_codes(dim_area))
    context.append(
        pawhp.assign(
            level="local-authority",
            indicator="pawhp-recipients",
            period="2025-26",
            value=pawhp.recipients,
            index="sss-pawhp",
        )
    )
    pay = pd.read_parquet(staged("pay"))
    pay = pay[pay.median_annual_pay_gbp.notna()]
    context.append(
        pay.assign(
            indicator="median-annual-pay",
            period=pay.year.astype(str),
            value=pay.median_annual_pay_gbp,
            index="ons-ashe",
        )
    )
    fact_context = pd.concat(context, ignore_index=True)[
        ["level", "code", "indicator", "period", "value", "index"]
    ].rename(columns={"index": "source"})

    members = pd.read_parquet(staged("members"))
    seats = dim_area[dim_area.level == "constituency"]
    by_name = {norm_name(n): c for n, c in zip(seats.name, seats.code, strict=True)}
    members["code"] = members.constituency_name.map(lambda n: by_name.get(norm_name(n)))
    representation = members[members.code.notna()].drop_duplicates("code")[["code", "member", "party", "since"]]

    for name, df, order in (
        ("dim_area", dim_area, "level, code"),
        ("dim_benefit", dim_benefit, "code"),
        ("dim_period", dim_period, "fiscal_year"),
        ("fact_spend_area", fact_spend, "level, code, fiscal_year, benefit_code, source"),
        ("fact_caseload_area", fact_caseload, "level, code, month, benefit_code"),
        ("fact_population", fact_population, "level, code, mid_year"),
        ("fact_tax_area", fact_tax, "level, code, fiscal_year"),
        ("fact_context", fact_context, "level, code, indicator"),
        ("bridge_area_overlap", overlaps, "constituency, local_authority"),
        ("dim_representation", representation, "code"),
        ("fact_election_2024", elections.build(dim_area), "constituency, position"),
        ("fact_pip_condition", conditions.build(dim_area), "level, code, condition"),
        ("qa_scotland_agency_model", checks, "benefit_code, fiscal_year"),
        ("qa_scotland_dwp_residual_caseload", residual, "benefit_code, month"),
    ):
        _write(con, name, df, order)
    print(
        f"canonical: {len(dim_area)} areas, {len(fact_spend)} spend rows, {len(fact_caseload)} caseload rows, "
        f"{len(fact_tax)} tax rows, {len(representation)} members matched",
        file=sys.stderr,
    )
    return {name: pd.read_parquet(canonical(name)) for name in TABLES}
