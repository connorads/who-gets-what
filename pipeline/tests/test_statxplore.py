"""Stat-Xplore request keys and snapshot choice."""

from __future__ import annotations

import pandas as pd

from wgw_pipeline.sources.statxplore import comparison_period, history_periods, request_key


def test_request_keys_are_stable() -> None:
    assert request_key("GET /schema") == request_key("GET /schema")
    assert len(request_key("POST {}")) == 16


def test_history_periods_follow_published_quarters_and_monthly_steps() -> None:
    quarterly = pd.DataFrame(
        {"period_code": ["202502", "202505", "202508", "202511", "202603"], "caseload": 1, "geo_code": "E92000001"}
    )
    monthly = pd.DataFrame(
        {"period_code": [f"2025{m:02d}" for m in range(1, 13)] + ["202601"], "caseload": 1, "geo_code": "E92000001"}
    )

    assert history_periods(quarterly, "quarterly", 4) == ["202502", "202505", "202508", "202511", "202603"]
    assert history_periods(monthly, "monthly", 4) == ["202501", "202504", "202507", "202510", "202601"]


def test_comparison_period_is_the_nearest_published_month_three_years_back() -> None:
    quarterly = pd.DataFrame(
        {"period_code": ["202211", "202302", "202305", "202511", "202603"], "caseload": 1, "geo_code": "E92000001"}
    )
    monthly = pd.DataFrame({"period_code": ["202306", "202307", "202308", "202607"], "caseload": 1, "geo_code": "x"})
    tie = pd.DataFrame({"period_code": ["202302", "202304", "202603"], "caseload": 1, "geo_code": "x"})

    assert comparison_period(quarterly, 3) == "202302"
    assert comparison_period(monthly, 3) == "202307"
    assert comparison_period(tie, 3) == "202302"
