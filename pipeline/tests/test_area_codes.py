"""Council re-keying and area names."""

from __future__ import annotations

import pandas as pd

from wgw_pipeline.canonical.areas import norm_name, slugify
from wgw_pipeline.canonical.la_codes import to_lad23


def test_to_lad23_sums_whole_predecessors_only_before_the_successor_exists() -> None:
    rows = pd.DataFrame(
        {
            "code": ["E07000049", "E07000050", "E07000051", "E07000052", "E07000053", "E06000059", "S12000046"],
            "year": ["2018-19"] * 5 + ["2019-20", "2017-18"],
            "v": [1.0, 2.0, 3.0, 4.0, 5.0, 20.0, 7.0],
        }
    )
    out = to_lad23(rows, code="code", year="year", values=["v"], keys=[]).set_index(["code", "year"]).v

    assert out[("E06000059", "2018-19")] == 15.0  # Dorset from its five districts
    assert out[("E06000059", "2019-20")] == 20.0
    assert out[("S12000049", "2017-18")] == 7.0  # Glasgow City's old code


def test_to_lad23_prefers_the_current_code_and_follows_chained_mergers() -> None:
    rows = pd.DataFrame(
        {
            "code": ["E07000190", "E07000191", "S12000049", "S12000046"],
            "year": ["2015-16", "2015-16", "2019-20", "2019-20"],
            "v": [1.0, 2.0, 10.0, 99.0],
        }
    )
    out = to_lad23(rows, code="code", year="year", values=["v"], keys=[]).set_index(["code", "year"]).v

    assert out[("E06000066", "2015-16")] == 3.0  # Taunton Deane + West Somerset -> SWT -> Somerset
    assert out[("S12000049", "2019-20")] == 10.0


def test_slugs_and_name_keys() -> None:
    assert slugify("Ynys Môn") == "ynys-mon"
    assert slugify("Brighton Kemptown and Peacehaven") == "brighton-kemptown-and-peacehaven"
    assert norm_name("Edinburgh, City of") == norm_name("City of Edinburgh")
