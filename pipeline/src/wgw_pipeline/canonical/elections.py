"""The 4 July 2024 general election by constituency: one row per candidacy.

Party is text. The Speaker stands as "Speaker" and candidates with no party as
"Independent". Turnout and majority shares follow the House of Commons
Library: both divide by valid votes cast, and turnout divides valid votes by
the electorate.
"""

from __future__ import annotations

import pandas as pd

from wgw_pipeline.paths import staged

SPEAKER = "Speaker"
INDEPENDENT = "Independent"


def build(dim_area: pd.DataFrame) -> pd.DataFrame:
    df = pd.read_parquet(staged("election_candidacies"))
    seats = set(dim_area[dim_area.level == "constituency"].code)
    df = df[df.code.isin(seats)].copy()
    df.loc[df.independent & df.party.isna(), "party"] = INDEPENDENT
    df.loc[df.speaker, "party"] = SPEAKER
    assert df.party.notna().all(), "every candidacy has a party, Independent or Speaker"
    df["candidate"] = df.given_name.str.strip() + " " + df.family_name.str.strip()
    return df[
        [
            "code",
            "polling_date",
            "electorate",
            "valid_votes",
            "invalid_votes",
            "position",
            "candidate",
            "party",
            "votes",
            "vote_share",
            "majority",
        ]
    ].rename(columns={"code": "constituency"})
