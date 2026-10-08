"""Scottish harmonisation: Social Security Scotland and modelled agency payments, never double counted."""

from __future__ import annotations

from wgw_pipeline import flags

SSS_CODES = {"ADP", "CDP", "PADP", "CSP", "PAWHP"}


def test_no_dwp_and_sss_double_count_in_scotland(tables) -> None:
    spend = tables["fact_spend_area"]
    scot = spend[spend.code.str.startswith("S")]
    start = scot.fiscal_year.str[:4].astype(int)
    devolved = {"AA": 2020, "PIP": 2020, "DLA": 2020, "SDA": 2020, "CA": 2019, "WFP": 2024}
    dwp_after = scot[
        scot.source.str.startswith("dwp-")
        & scot.benefit_code.isin(devolved)
        & (start >= scot.benefit_code.map(devolved).fillna(9999))
    ]
    assert dwp_after.empty, dwp_after.head()
    caseload = tables["fact_caseload_area"]
    residual = caseload[caseload.code.str.startswith("S") & caseload.benefit_code.isin({"AA", "PIP", "DLA", "CA"})]
    assert residual.empty


def test_scottish_sss_values_are_flagged(tables) -> None:
    spend = tables["fact_spend_area"]
    sss = spend[spend.benefit_code.isin(SSS_CODES)]
    assert ((sss["flags"] & flags.HARMONISED) != 0).all()
    seats = spend[(spend.level == "constituency") & spend.code.str.startswith("S") & (spend.method == "apportioned")]
    assert len(seats) > 0
    assert ((seats["flags"] & flags.APPORTIONED) != 0).all()
    assert set(seats[seats.benefit_code.isin(SSS_CODES)].benefit_code) == SSS_CODES
    modelled = spend[spend.source == "wgw-scotland-model"]
    assert ((modelled["flags"] & flags.MODELLED) != 0).all()
    caseload = tables["fact_caseload_area"]
    sss_seats = caseload[(caseload.level == "constituency") & caseload.benefit_code.isin(SSS_CODES)]
    assert len(sss_seats) > 0
    assert (
        (sss_seats["flags"] & (flags.APPORTIONED | flags.HARMONISED)) == (flags.APPORTIONED | flags.HARMONISED)
    ).all()


def test_scottish_disability_and_carer_families_are_filled_after_devolution(tables) -> None:
    spend = tables["fact_spend_area"]
    areas = tables["dim_area"]
    scot = areas[areas.nation == "scotland"]
    for family in ("personal-independence", "disability-living", "attendance-allowance", "carers"):
        for year in ("2020-21", "2022-23", "2024-25"):
            rows = spend[(spend.family == family) & (spend.fiscal_year == year)]
            have = set(zip(rows.level, rows.code, strict=True))
            missing = [c for c in zip(scot.level, scot.code, strict=True) if c not in have]
            assert not missing, f"{family} {year}: {missing[:3]}"


def test_scotland_agency_model_reproduces_outturn_where_it_can_be_checked(qa_table) -> None:
    qa = qa_table("qa_scotland_agency_model")
    pre = qa[(qa.fiscal_year == "2019-20") & qa.benefit_code.isin(["AA", "PIP", "DLA"])]
    assert len(pre) == 3
    assert ((pre.scotland_predicted / pre.scotland_outturn - 1).abs() < 0.02).all()
    wales = qa[qa.fiscal_year <= "2024-25"]
    assert ((wales.wales_predicted / wales.wales_outturn - 1).abs() < 0.03).all()
