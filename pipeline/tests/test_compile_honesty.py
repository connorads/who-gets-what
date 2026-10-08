"""Honesty rules on the compiled release: denominators, same-year ratios, ranks, prices and copy."""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pytest

from wgw_pipeline import flags
from wgw_pipeline.canonical.benefits import PENSIONER_FAMILIES, WORKING_AGE_FAMILIES
from wgw_pipeline.compile import bundle
from wgw_pipeline.compile.spec import (
    CARERS_AGED_16_64_PERCENT,
    CAVEATS,
    DECOMPOSITION_METHOD,
    DEFAULT_METRIC,
    METRICS,
    UC_AGED_16_64_PERCENT,
)
from wgw_pipeline.paths import CONTRACT_DIR

BANNED = tuple(json.loads((CONTRACT_DIR / "neutrality/banned-words.json").read_text())["phrases"])
# The same whole-word rule as `findBannedPhrases` in src/domain/neutrality.ts.
BANNED_RE = re.compile(r"(?<![\w'-])(?:" + "|".join(re.escape(p) for p in BANNED) + r")(?![\w'-])", re.IGNORECASE)


def banned_phrases(text: str) -> list[str]:
    normalised = re.sub(r"\s+", " ", text.replace("\u2018", "'").replace("\u2019", "'"))
    return [m.group(0).lower() for m in BANNED_RE.finditer(normalised)]


def _series(release_root: Path, level: str, metric: str, denominator: str) -> tuple[dict, np.ndarray, np.ndarray]:
    header, (values, flag_values) = bundle.decode(
        (release_root / f"series/{level}/{metric}/{denominator}.bin").read_bytes()
    )
    shape = (len(header["periods"]), header["areaCount"])
    return header, values.reshape(shape), flag_values.reshape(shape)


def test_denominators_match_the_age_band_a_benefit_serves(read_json) -> None:
    cat = read_json("meta/catalogue.json")
    for m in cat["metrics"]:
        fams = set(m["families"])
        if fams and fams <= set(PENSIONER_FAMILIES):
            assert not {"per-aged-16-64", "per-aged-0-15"} & set(m["denominators"]), m["id"]
        if fams and fams <= set(WORKING_AGE_FAMILIES):
            assert not {"per-aged-66-plus", "per-aged-0-15"} & set(m["denominators"]), m["id"]
        if fams & {"personal-independence", "disability-living", "housing-benefit", "other"} or len(fams) > 6:
            assert set(m["denominators"]) <= {"total", "per-resident"}, m["id"]


def test_fiscal_year_spending_uses_the_mid_year_population_at_the_start_of_the_year(tables, release_root: Path) -> None:
    header, values, _ = _series(release_root, "local-authority", "spend-total", "per-resident")
    _, totals, _ = _series(release_root, "local-authority", "spend-total", "total")
    pop = tables["fact_population"].query("level == 'local-authority'").set_index(["code", "mid_year"]).total
    codes = [a["code"] for a in json.loads((release_root / "meta/areas-local-authority.json").read_text())["areas"]]
    p = header["periods"].index("2024-25")
    i = codes.index("E06000001")
    assert values[p, i] == pytest.approx(totals[p, i] / pop[("E06000001", 2024)], rel=1e-5)


def test_ratios_pair_spending_and_income_tax_of_the_same_year(release_root: Path) -> None:
    for level in ("constituency", "local-authority"):
        ratio_header, ratio, _ = _series(release_root, level, "spend-to-income-tax", "total")
        spend_header, spend, _ = _series(release_root, level, "spend-total", "total")
        tax_header, tax, _ = _series(release_root, level, "income-tax", "total")
        for p, period in enumerate(ratio_header["periods"]):
            s = spend[spend_header["periods"].index(period)]
            t = tax[tax_header["periods"].index(period)]
            ok = np.isfinite(ratio[p])
            assert ok.sum() > 0.9 * len(ok)
            assert np.allclose(ratio[p][ok], (s / t)[ok], rtol=1e-4)


def test_small_populations_are_flagged_and_unranked(release_root: Path, tables) -> None:
    small = 0
    for path in (release_root / "area").rglob("*.json"):
        for facts in json.loads(path.read_text())["facts"]:
            for value_flags, rank in zip(facts["flags"], facts["ranks"], strict=True):
                if value_flags & flags.SMALL_POPULATION:
                    small += 1
                    assert rank is None
                if value_flags & (flags.PARTIAL_COVERAGE | flags.SUPPRESSED):
                    assert rank is None
    assert small > 0  # the Isles of Scilly and the City of London fall under the floor
    pop = tables["fact_population"].query("mid_year == 2024")
    assert (pop.aged_66_plus < 1000).any()


def test_price_base_factors_are_one(read_json) -> None:
    cat = read_json("meta/catalogue.json")
    base = next(y for y in cat["fiscalYears"] if y["id"] == cat["priceBase"])
    assert base == {"id": "2026-27", "status": "forecast", "realGdp": 1.0, "realCpi": 1.0}


def test_northern_ireland_is_labelled_not_covered(read_json) -> None:
    for level in ("constituency", "local-authority"):
        assert not [a for a in read_json(f"meta/areas-{level}.json")["areas"] if a["code"].startswith("N")]
    assert read_json("manifest.json")["coverage"]["notCovered"][0]["area"] == "Northern Ireland"


def test_banned_phrase_matching_follows_the_shared_rule() -> None:
    assert "net contributor" in BANNED
    assert banned_phrases("A NET\n contributor and taxpayers\u2019 money") == ["net contributor", "taxpayers' money"]
    assert banned_phrases("Drainage, mergers and a deservingly long table.") == []


def test_metric_labels_capitalise_only_benefit_names() -> None:
    labels = {m.id: m.label for m in METRICS}
    assert labels["spend-other"] == "Spending on other benefits"
    assert labels["spend-state-pension"] == "Spending on State Pension"


def test_explorer_opens_on_the_measure_the_film_leads_with() -> None:
    by_id = {m.id: m for m in METRICS}
    assert by_id[DEFAULT_METRIC].label == "Benefit spending"
    assert by_id[DEFAULT_METRIC].default_denominator == "per-resident"


def test_the_income_tax_ratio_reads_as_benefits_for_each_pound_of_income_tax() -> None:
    ratio = next(m for m in METRICS if m.unit == "ratio")
    assert "for each £1 of income tax" in ratio.label
    assert "total" not in f"{ratio.label} {ratio.short_label} {ratio.description}".lower()


def test_copy_uses_no_banned_words() -> None:
    texts = [m.label for m in METRICS] + [m.description for m in METRICS] + list(CAVEATS.values())
    texts.append(DECOMPOSITION_METHOD)
    for text in texts:
        assert banned_phrases(text) == [], text


def test_totals_that_predate_area_universal_credit_say_so(read_json) -> None:
    cat = read_json("meta/catalogue.json")
    by_id = {m["id"]: m for m in cat["metrics"]}
    first_uc = by_id["spend-universal-credit"]["periods"][0]
    sums = [m for m in cat["metrics"] if "universal-credit" in m["families"] and m["periodKind"] == "fiscal-year"]
    assert sums
    for m in sums:
        if m["id"] != "spend-universal-credit" and m["periods"][0] < first_uc:
            assert "uc-history" in m["caveats"], m["id"]


def test_income_tax_is_never_called_a_net_position(read_json) -> None:
    cat = read_json("meta/catalogue.json")
    tax_metrics = [m for m in cat["metrics"] if "income-tax" in m["id"]]
    assert tax_metrics and all("income-tax-only" in m["caveats"] for m in tax_metrics)


def test_scotland_harmonised_series_are_continuous(release_root: Path) -> None:
    """Scotland's disability spending does not collapse when PIP moves to ADP."""
    header, values, _ = _series(release_root, "local-authority", "spend-personal-independence", "total")
    periods = header["periods"]
    meta = json.loads((release_root / "meta/areas-local-authority.json").read_text())
    scot = [i for i, a in enumerate(meta["areas"]) if a["nation"] == "scotland"]
    totals = {p: float(np.nansum(values[periods.index(p), scot])) for p in ("2019-20", "2021-22", "2024-25")}
    assert totals["2021-22"] > 0.9 * totals["2019-20"]
    assert totals["2024-25"] > 0.9 * totals["2021-22"]


def test_carers_rates_count_only_people_aged_16_to_64(tables, release_root: Path) -> None:
    """ADR 0004 rule 1: a per-16-64 rate never divides an all-ages count, and
    every denominator of the metric shares the same 16-64 numerator."""
    caseload = tables["fact_caseload_area"].query("level == 'local-authority' and not code.str.startswith('S')")
    ca = caseload[caseload.benefit_code.isin(["CA", "CA_16_64"])].pivot_table(
        index=["month", "code"], columns="benefit_code", values="caseload"
    )
    # Stat-Xplore perturbs small cells, so a tiny area can show a few more.
    assert (ca.CA_16_64 <= ca.CA + 5).all()
    assert (ca.CA_16_64 < ca.CA).mean() > 0.9
    latest = ca.loc[ca.index.get_level_values("month").max()]
    assert round(latest.CA_16_64.sum() / latest.CA.sum() * 100) == CARERS_AGED_16_64_PERCENT

    pop = tables["fact_population"].query("mid_year == 2024")
    for level in ("constituency", "local-authority"):
        header, totals, _ = _series(release_root, level, "claimants-carers", "total")
        _, rates, rate_flags = _series(release_root, level, "claimants-carers", "per-aged-16-64")
        meta = json.loads((release_root / f"meta/areas-{level}.json").read_text())
        codes = [a["code"] for a in meta["areas"]]
        band = pop[pop.level == level].set_index("code").aged_16_64.reindex(codes).to_numpy()
        ok = np.isfinite(rates[-1])
        assert ok.mean() > 0.9
        assert np.allclose(rates[-1][ok], (totals[-1] / band * 1000)[ok], rtol=1e-4)
        scottish = np.array([c.startswith("S") for c in codes])
        assert (rate_flags[-1][scottish & ok] & flags.MODELLED).all()
        assert not (rate_flags[-1][~scottish & ok] & flags.MODELLED).any()
        month = header["periods"][-1]
        counted = tables["fact_caseload_area"].query(
            "level == @level and benefit_code in ('CA_16_64', 'CSP_16_64') and code.str.startswith('E')"
        )
        counted = counted[counted.month == month].set_index("code").caseload.reindex(codes)
        english = np.array([c.startswith("E") for c in codes])
        assert np.allclose(totals[-1][english], counted.to_numpy()[english], rtol=1e-5)


def test_universal_credit_rates_count_only_people_aged_16_to_64(tables, release_root: Path) -> None:
    """ADR 0004 rule 1: the per-16-64 Universal Credit rate divides a count of
    people aged 16 to 64, never everyone on Universal Credit."""
    caseload = tables["fact_caseload_area"].query("level == 'local-authority'")
    uc = caseload[caseload.benefit_code.isin(["UC", "UC_16_64"])].pivot_table(
        index=["month", "code"], columns="benefit_code", values="caseload"
    )
    assert uc.UC_16_64.notna().all()
    assert (uc.UC_16_64 <= uc.UC + 5).all()
    assert (uc.UC_16_64 < uc.UC).mean() > 0.9
    latest = uc.loc[uc.index.get_level_values("month").max()]
    assert round(latest.UC_16_64.sum() / latest.UC.sum() * 100) == UC_AGED_16_64_PERCENT

    pop = tables["fact_population"].query("mid_year == 2024")
    for level in ("constituency", "local-authority"):
        header, totals, _ = _series(release_root, level, "claimants-universal-credit", "total")
        _, rates, _ = _series(release_root, level, "claimants-universal-credit", "per-aged-16-64")
        codes = [a["code"] for a in json.loads((release_root / f"meta/areas-{level}.json").read_text())["areas"]]
        band = pop[pop.level == level].set_index("code").aged_16_64.reindex(codes).to_numpy()
        counted = tables["fact_caseload_area"].query("level == @level and benefit_code == 'UC_16_64'")
        for p, month in enumerate(header["periods"]):
            ok = np.isfinite(rates[p])
            assert ok.mean() > 0.99
            assert np.allclose(rates[p][ok], (totals[p] / band * 1000)[ok], rtol=1e-4)
            aged = counted[counted.month == month].set_index("code").caseload.reindex(codes).to_numpy()
            assert np.allclose(totals[p], aged, rtol=1e-5, equal_nan=True)


def test_gb_values_are_gb_totals_not_means_of_areas(tables, release_root: Path, read_json) -> None:
    gb = {(g["metric"], g["denominator"]): g for g in read_json("meta/gb-local-authority.json")["series"]}
    header, totals, _ = _series(release_root, "local-authority", "spend-total", "total")
    p = header["periods"].index("2024-25")
    total = gb[("spend-total", "total")]
    assert total["values"][total["periods"].index("2024-25")] == pytest.approx(float(np.nansum(totals[p])), rel=1e-6)
    pop = tables["fact_population"].query("level == 'local-authority' and mid_year == 2024").total.sum()
    rate = gb[("spend-total", "per-resident")]
    assert rate["values"][rate["periods"].index("2024-25")] == pytest.approx(
        float(np.nansum(totals[p])) / pop, rel=1e-4
    )


def test_gb_values_are_one_numerator_over_one_population_at_every_level(tables, release_root: Path, read_json) -> None:
    """A constituency page and a council page show the same GB figure: one GB
    numerator and one GB population, both summed over councils."""
    by_level = {
        level: {(g["metric"], g["denominator"]): g for g in read_json(f"meta/gb-{level}.json")["series"]}
        for level in ("constituency", "local-authority")
    }
    shared = 0
    for key, seat in by_level["constituency"].items():
        council = by_level["local-authority"][key]
        for period, value in zip(seat["periods"], seat["values"], strict=True):
            assert period in council["periods"], (key, period)
            assert value == council["values"][council["periods"].index(period)], (key, period)
            shared += 1
    assert shared > 300

    header, totals, _ = _series(release_root, "local-authority", "spend-pensioner", "total")
    pop = tables["fact_population"].query("level == 'local-authority' and mid_year == 2024").aged_66_plus.sum()
    rate = by_level["constituency"][("spend-pensioner", "per-aged-66-plus")]
    assert rate["values"][rate["periods"].index("2024-25")] == pytest.approx(
        float(np.nansum(totals[header["periods"].index("2024-25")])) / pop, rel=1e-4
    )


def _dossiers(release_root: Path, level: str) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted((release_root / f"area/{level}").glob("*.json"))]


def test_election_results_add_up_and_name_party_as_text(release_root: Path) -> None:
    """Every constituency has its 2024 result: shares of valid votes that sum to
    one, the majority as the lead over the second candidate, and turnout as
    valid votes over the electorate (House of Commons Library definitions)."""
    seats = _dossiers(release_root, "constituency")
    assert len(seats) == 632
    for d in seats:
        e = d["election"]
        votes = [c["votes"] for c in e["candidates"]]
        assert votes == sorted(votes, reverse=True)
        assert sum(votes) == e["validVotes"]
        assert sum(c["share"] for c in e["candidates"]) == pytest.approx(1, abs=0.002)
        assert e["majority"] == votes[0] - votes[1]
        assert e["majorityShare"] == pytest.approx(e["majority"] / e["validVotes"], abs=1e-4)
        assert e["turnout"] == pytest.approx(e["validVotes"] / e["electorate"], abs=1e-4)
        assert all(c["party"] and not c["party"].startswith("#") for c in e["candidates"])
        assert "election-2024" in d["caveats"]
    assert all(d["election"] is None for d in _dossiers(release_root, "local-authority"))


def test_pip_conditions_leave_out_scotland_and_flag_withheld_cells(release_root: Path, read_json, tables) -> None:
    """Condition counts are DWP's for England and Wales only; Scottish areas
    say why they have none, and every withheld count is empty and flagged."""
    cat = read_json("meta/catalogue.json")["conditions"]
    assert cat["nations"] == ["england", "wales"]
    shares = [g["share"] for g in cat["groups"]]
    assert shares == sorted(shares, reverse=True)
    assert sum(shares) == pytest.approx(1, abs=0.002)
    pip = tables["fact_caseload_area"].query("benefit_code == 'PIP' and month == @cat['month']")
    pip = pip.set_index(["level", "code"]).caseload
    for level in ("constituency", "local-authority"):
        for d in _dossiers(release_root, level):
            code = d["area"]["code"]
            if code.startswith("S"):
                assert d["conditions"] is None
                assert "pip-conditions-scotland" in d["caveats"]
                continue
            c = d["conditions"]
            assert len(c["claimants"]) == len(c["flags"]) == len(cat["groups"])
            for count, flag in zip(c["claimants"], c["flags"], strict=True):
                assert (count is None) == bool(flag & flags.SUPPRESSED)
            # Stat-Xplore perturbs each cell, so groups and the total differ by a few people.
            assert sum(n or 0 for n in c["claimants"]) == pytest.approx(pip[(level, code)], abs=60)
