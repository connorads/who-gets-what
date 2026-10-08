"""Current MPs and 2024 general election results, from UK Parliament (Open Parliament Licence).

Members carry their constituency by name, not GSS code, so they are matched to
2024 constituencies on a normalised name. An unmatched seat has no
representation in its dossier rather than a guessed one.

Election results come from the House of Commons Library's election results
service, one row per candidacy with the constituency's GSS code, electorate
and valid votes, so they need no name matching.
"""

from __future__ import annotations

import json
import sys

import pandas as pd

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import staged

SOURCE = "parliament"
MEMBERS = "https://members-api.parliament.uk/api/Members/Search?House=1&IsCurrentMember=true"
# General election 6 is 4 July 2024; election 5 is the notional 2019 result on 2024 boundaries.
ELECTION_2024 = "https://electionresults.parliament.uk/general-elections/6/candidacies.csv"
CANDIDACY_COLUMNS = {
    "Constituency geographic code": "code",
    "Election polling date": "polling_date",
    "Election is by-election": "by_election",
    "Electorate": "electorate",
    "Election valid vote count": "valid_votes",
    "Election invalid vote count": "invalid_votes",
    "Election result summary": "result",
    "Candidate given name": "given_name",
    "Candidate family name": "family_name",
    "Main party name": "party",
    "Candidate is standing as Commons Speaker": "speaker",
    "Candidate is standing as independent": "independent",
    "Candidate vote count": "votes",
    "Candidate vote share": "vote_share",
    "Majority": "majority",
    "Candidate result position": "position",
}


def ingest_election(cache: RawCache) -> None:
    raw = cache.fetch(SOURCE, ELECTION_2024, ext="csv", key="general-election-2024-candidacies")
    df = pd.read_csv(raw.path, encoding="utf-8-sig", dtype={"Constituency geographic code": str})
    df = df[list(CANDIDACY_COLUMNS)].rename(columns=CANDIDACY_COLUMNS)
    assert not df.by_election.any(), "a general election file holds no by-elections"
    df.drop(columns="by_election").to_parquet(staged("election_candidacies"), index=False)
    print(f"  parliament: {df.code.nunique()} constituencies, {len(df)} candidacies in 2024", file=sys.stderr)


def ingest(cache: RawCache) -> None:
    ingest_election(cache)

    def fetcher() -> tuple[bytes, None]:
        items: list[object] = []
        skip = 0
        while True:
            page = cache.request("GET", f"{MEMBERS}&skip={skip}&take=20", timeout=60).json()
            items += [i["value"] for i in page["items"]]
            skip += 20
            if skip >= page["totalResults"]:
                break
        return json.dumps(items).encode(), None

    members = cache.get(SOURCE, "members-current", MEMBERS, "json", fetcher).read_json()
    assert isinstance(members, list)
    rows = [
        {
            "constituency_name": m["latestHouseMembership"]["membershipFrom"],
            "member": m["nameDisplayAs"],
            "party": m["latestParty"]["name"],
            "since": m["latestHouseMembership"]["membershipStartDate"][:10],
            "mnis_id": m["id"],
        }
        for m in members
    ]
    pd.DataFrame(rows).to_parquet(staged("members"), index=False)
    print(f"  parliament: {len(rows)} current members", file=sys.stderr)
