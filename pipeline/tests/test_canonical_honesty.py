"""Honesty tests on DWP sources and the canonical tables (ADR 0004, research ingest spec)."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from wgw_pipeline import flags
from wgw_pipeline.canonical.benefits import BY_CODE

DEVOLVED_DWP = {"AA", "PIP", "DLA", "CA", "SDA", "WFP"}
STABLE_BENEFITS = {"SP": "SP", "PC": "PC", "AA": "AA", "PIP": "PIP", "CA": "CA", "DLA": "DLA"}


def test_seats_plus_abroad_equal_gb_for_every_benefit(staged_table) -> None:
    pcon = staged_table("dwp_spend_pcon")
    year = pcon[(pcon.boundary == "PCON2024") & (pcon.fiscal_year == "2024-25") & (pcon.benefit_code != "TOTAL")]
    seats = year[year.area_level == "pcon"].groupby("benefit_code").spend_gbp_m.sum()
    abroad = year[year.area_level == "abroad_or_unknown"].groupby("benefit_code").spend_gbp_m.sum()
    gb = year[year.gss == "K03000001"].groupby("benefit_code").spend_gbp_m.sum()
    joined = pd.concat([seats.rename("seats"), abroad.rename("abroad"), gb.rename("gb")], axis=1).fillna(0)
    joined = joined[joined.gb > 0]
    assert len(joined) >= 15
    gap = (joined.seats + joined.abroad - joined.gb).abs() / joined.gb
    assert (gap < 1e-6).all(), gap[gap >= 1e-6]


def test_local_authority_and_seat_sums_agree(staged_table) -> None:
    la = staged_table("dwp_spend_la")
    pcon = staged_table("dwp_spend_pcon")
    la_sum = la[(la.area_level == "la") & (la.fiscal_year == "2024-25")].groupby("benefit_code").spend_gbp_m.sum()
    pc = pcon[(pcon.boundary == "PCON2024") & (pcon.area_level == "pcon") & (pcon.fiscal_year == "2024-25")]
    pc_sum = pc.groupby("benefit_code").spend_gbp_m.sum()
    both = pd.concat([la_sum.rename("la"), pc_sum.rename("pc")], axis=1).dropna()
    # Top-level benefits only: the published TOTAL and sub-rows are never used.
    top = [c for c in both.index if c in BY_CODE and BY_CODE[c].family is not None]
    both = both.loc[top]
    gap = (both.la - both.pc).abs() / both.pc
    assert (gap < 0.005).all(), gap[gap >= 0.005]
    assert abs(both.la.sum() / both.pc.sum() - 1) < 0.001


def test_area_totals_match_dwp_outturn(staged_table) -> None:
    pcon = staged_table("dwp_spend_pcon")
    outturn = staged_table("dwp_outturn")
    gb = pcon[(pcon.gss == "K03000001") & (pcon.boundary == "PCON2024") & (pcon.fiscal_year == "2024-25")]
    gb = gb.set_index("benefit_code").spend_gbp_m
    table = outturn[outturn.fiscal_year == "2024-25"].set_index("line_item").spend_gbp_m
    assert abs(gb["SP"] / table["State Pension"] - 1) < 0.001
    assert abs(gb["PIP"] / table["Personal Independence Payment"] - 1) < 0.001


def test_run_rates_match_area_outturn_for_stable_benefits(staged_table) -> None:
    """Caseload x mean award x 52, scaled to the GB outturn, lands within 3% per seat (median)."""
    sx = staged_table("statxplore_area")
    pcon = staged_table("dwp_spend_pcon")
    spend = pcon[(pcon.boundary == "PCON2024") & (pcon.area_level == "pcon") & (pcon.fiscal_year == "2024-25")]
    for sx_code, dwp_code in STABLE_BENEFITS.items():
        b = sx[(sx.level == "constituency") & (sx.benefit_code == sx_code)]
        b = b[b.month == b.month.max()]
        rate = (b.caseload * b.mean_weekly_gbp * 52).groupby(b.code).sum()
        out = spend[spend.benefit_code == dwp_code].set_index("gss").spend_gbp_m.dropna()
        common = out.index.intersection(rate.index)
        common = common[~common.str.startswith("S")] if dwp_code in DEVOLVED_DWP else common
        r, o = rate[common], out[common]
        scaled = r / r.sum() * o.sum()
        error = ((scaled - o).abs() / o).median()
        assert error < 0.03, f"{dwp_code}: median per-seat error {error:.3f}"


def test_no_published_total_rows_are_used(tables) -> None:
    assert "TOTAL" not in set(tables["fact_spend_area"].benefit_code)
    assert tables["fact_spend_area"].family.notna().any()


def test_constituencies_are_2024_boundaries_only(tables, staged_table) -> None:
    spend = tables["fact_spend_area"]
    seats = set(tables["dim_area"].query("level == 'constituency'").code)
    seat_rows = spend[spend.level == "constituency"]
    assert set(seat_rows.code) <= seats
    assert seat_rows.fiscal_year.min() >= "2018-19"
    pcon = staged_table("dwp_spend_pcon")
    old = set(pcon[(pcon.boundary == "PCON2010") & (pcon.area_level == "pcon")].gss)
    assert not (old - seats) & set(seat_rows.code)


def test_abroad_spending_is_in_gb_totals_but_in_no_area(tables, staged_table) -> None:
    pcon = staged_table("dwp_spend_pcon")
    abroad = pcon[
        (pcon.area_level == "abroad_or_unknown") & (pcon.boundary == "PCON2024") & (pcon.fiscal_year == "2024-25")
    ]
    assert abroad.spend_gbp_m.sum() > 5000  # about £5.6bn
    codes = set(tables["fact_spend_area"].code)
    assert all(re.fullmatch(r"[EWS]\d{8}", c) for c in codes)
    assert not {c for c in codes if c.startswith(("K", "E92", "W92", "S92", "E12"))}


def test_local_authority_and_constituency_totals_agree_after_harmonisation(tables) -> None:
    spend = tables["fact_spend_area"]
    year = spend[(spend.fiscal_year == "2024-25") & spend.family.notna()]
    by = year.groupby(["family", "level"]).value_gbp.sum().unstack()
    gap = (by["constituency"] - by["local-authority"]).abs() / by["local-authority"]
    assert (gap < 0.005).all(), gap[gap >= 0.005]


def test_income_tax_is_survey_flagged_and_suppressed_cells_stay_empty(tables, staged_table) -> None:
    tax = tables["fact_tax_area"]
    assert ((tax["flags"] & flags.SURVEY) != 0).all()
    suppressed = tax[(tax["flags"] & flags.SUPPRESSED) != 0]
    assert suppressed.income_tax_gbp.isna().all()
    spi = staged_table("hmrc_spi")
    withheld = spi[
        (spi.table == "3.15") & spi.tax_total_suppressed & spi.area_code.fillna("").str.match(r"^[EWS]14|^W07")
    ]
    seats = tax[tax.level == "constituency"].set_index("code")
    for code in withheld.area_code:
        assert np.isnan(seats.loc[code, "income_tax_gbp"])


def test_no_northern_ireland_codes(tables) -> None:
    for name in ("dim_area", "fact_spend_area", "fact_caseload_area", "fact_population", "fact_tax_area"):
        assert not tables[name].code.str.startswith("N").any(), name
