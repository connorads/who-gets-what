"""DWP Stat-Xplore Open Data API client and the caseload queries the site uses.

Requests are cached by a hash of the request (`GET <path>` or `POST <sorted JSON
body>`), the same key the exploration prototype used, so its downloads seed
this cache. Requests run one at a time: parallel heavy queries trigger HTTP 429
even when `/rate_limit` reports capacity. Large tables time out at the gateway
(HTTP 504) after about 60 seconds, so table queries split by period or area and
halve a chunk on 504.

The API key comes from `STAT_XPLORE_API_KEY`, or a gitignored `pipeline/.env`.
It is sent as the `APIKey` header and never logged. The repository root `.env`
is not used: the Cloudflare Vite plugin loads it into the Worker's
environment and copies it into the build.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any

import pandas as pd
import requests

from wgw_pipeline.cache import RawCache
from wgw_pipeline.paths import PIPELINE_DIR

BASE = "https://stat-xplore.dwp.gov.uk/webapi/rest/v1"
SOURCE = "statxplore"
KEY_ENV = "STAT_XPLORE_API_KEY"

# Geography valuesets. Codes for constituency and LA queries come from our own
# area lists; the schema endpoint truncates at 100 children.
PCON_VALUESET = "V_C_MASTERGEOG21_PARLC24_TO_REGION"
LA_VALUESET = "V_C_MASTERGEOG21_LA_TO_REGION"


@dataclass(frozen=True)
class Benefit:
    """One Stat-Xplore database. `amount` is the MEAN measure and its period."""

    key: str
    db: str
    table: str
    date: str
    amount: tuple[str, str] | None
    label: str
    freq: str

    @property
    def count_id(self) -> str:
        return f"str:count:{self.db}:{self.table}"

    @property
    def mean_id(self) -> str | None:
        if self.amount is None:
            return None
        return f"str:statfn:{self.db}:{self.table}:{self.amount[0]}:MEAN"

    def field(self, name: str) -> str:
        return f"str:field:{self.db}:{self.table}:{name}"


def _b(
    key: str, db: str, table: str, date_field: str, amount: tuple[str, str] | None, label: str, freq: str
) -> Benefit:
    return Benefit(key, db, table, f"str:field:{db}:{date_field}", amount, label, freq)


BENEFITS: dict[str, Benefit] = {
    b.key: b
    for b in (
        _b(
            "state_pension",
            "SP_New",
            "V_F_SP_CASELOAD_New",
            "F_SP_QTR_New:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "State Pension",
            "quarterly",
        ),
        _b(
            "pension_credit",
            "PC_New",
            "V_F_PC_CASELOAD_New",
            "F_PC_QTR_New:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "Pension Credit",
            "quarterly",
        ),
        _b(
            "attendance_allowance",
            "AA_In_Payment_New",
            "V_F_AA_In_Payment_New",
            "F_AA_QTR_New:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "Attendance Allowance (in payment)",
            "quarterly",
        ),
        _b(
            "pip",
            "PIP_Monthly_new",
            "V_F_PIP_MONTHLY",
            "F_PIP_DATE:DATE2",
            ("PIP_AWARD_AMOUNT", "weekly"),
            "Personal Independence Payment (entitled)",
            "monthly",
        ),
        _b(
            "uc_households",
            "UC_Households",
            "V_F_UC_HOUSEHOLDS",
            "F_UC_HH_DATE:DATE_NAME",
            ("HNTOTAL_PAYMENT_AMOUNT", "monthly"),
            "Universal Credit households",
            "monthly",
        ),
        _b(
            "uc_people",
            "UC_Monthly",
            "V_F_UC_CASELOAD_FULL",
            "F_UC_DATE:DATE_NAME",
            None,
            "Universal Credit people",
            "monthly",
        ),
        _b(
            "housing_benefit",
            "hb_new",
            "V_F_HB_NEW",
            "F_HB_NEW_DATE:NEW_DATE_NAME",
            ("LAHBAMT", "weekly"),
            "Housing Benefit",
            "monthly",
        ),
        _b(
            "dla",
            "DLA_In_Payment_New",
            "V_F_DLA_In_Payment_New",
            "F_DLA_QTR_New:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "Disability Living Allowance (in payment)",
            "quarterly",
        ),
        _b(
            "carers_allowance",
            "CA_In_Payment_New",
            "V_F_CA_In_Payment_New",
            "F_CA_QTR_New:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "Carer's Allowance (in payment)",
            "quarterly",
        ),
        _b(
            "esa",
            "ESA_Caseload_new",
            "V_F_ESA_NEW",
            "F_ESA_QTR_NEW:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "Employment and Support Allowance",
            "quarterly",
        ),
        _b(
            "jsa",
            "JSA_NEW",
            "V_F_JSA_NEW",
            "F_JSA_QTR_NEW:DATE_NAME",
            ("CAWKLYAMT", "weekly"),
            "Jobseeker's Allowance",
            "quarterly",
        ),
    )
}

# Stat-Xplore benefit key -> canonical benefit code.
BENEFIT_CODE = {
    "state_pension": "SP",
    "pension_credit": "PC",
    "attendance_allowance": "AA",
    "pip": "PIP",
    "uc_households": "UC_HH",
    "uc_people": "UC",
    "housing_benefit": "HB",
    "dla": "DLA",
    "carers_allowance": "CA",
    "esa": "ESA",
    "jsa": "JSA",
}


class Timeout504(RuntimeError):
    pass


def load_api_key() -> str | None:
    """The key from the environment, else from the gitignored `pipeline/.env`."""
    if value := os.environ.get(KEY_ENV):
        return value.strip()
    env = PIPELINE_DIR / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == KEY_ENV and value.strip():
                return value.strip().strip("'\"")
    return None


def request_key(name: str) -> str:
    return hashlib.sha1(name.encode()).hexdigest()[:16]


class StatXplore:
    def __init__(self, cache: RawCache) -> None:
        self.cache = cache
        self._session: requests.Session | None = None
        self.requests_made = 0

    def _http(self) -> requests.Session:
        if self._session is None:
            key = load_api_key()
            if not key:
                raise RuntimeError(f"{KEY_ENV} is not set; Stat-Xplore needs an API key for uncached queries")
            session = requests.Session()
            session.headers.update({"APIKey": key, "Content-Type": "application/json"})
            self._session = session
        return self._session

    # ------------------------------------------------------------ transport

    def get(self, path: str) -> Any:
        def fetcher() -> tuple[bytes, None]:
            for attempt in range(6):
                self.requests_made += 1
                r = self._http().get(BASE + path, timeout=120)
                if r.status_code == 200:
                    return r.content, None
                if r.status_code in (429, 500, 502, 503, 504) and attempt < 5:
                    time.sleep(60 if r.status_code == 429 else 5 * (attempt + 1))
                    continue
                raise RuntimeError(f"Stat-Xplore GET {path} -> HTTP {r.status_code}")
            raise RuntimeError("unreachable")

        return self.cache.get(SOURCE, request_key("GET " + path), BASE + path, "json", fetcher).read_json()

    def table(self, body: dict[str, Any]) -> Any:
        text = json.dumps(body, sort_keys=True)

        def fetcher() -> tuple[bytes, None]:
            for attempt in range(12):
                self.requests_made += 1
                try:
                    r = self._http().post(BASE + "/table", data=text, timeout=600)
                except requests.RequestException:
                    time.sleep(10)
                    continue
                if r.status_code == 200:
                    return r.content, None
                if r.status_code == 504:
                    raise Timeout504("gateway timeout")
                if r.status_code == 429:
                    print("  Stat-Xplore 429; backing off 60s", file=sys.stderr)
                    time.sleep(60)
                    continue
                if r.status_code in (500, 502, 503):
                    time.sleep(10 * (attempt + 1))
                    continue
                raise RuntimeError(f"Stat-Xplore table -> HTTP {r.status_code}: {r.text[:300]}")
            raise RuntimeError("Stat-Xplore table: retries exhausted")

        return self.cache.get(SOURCE, request_key("POST " + text), BASE + "/table", "json", fetcher).read_json()

    def children(self, id_: str) -> list[dict[str, Any]]:
        schema = self.get(f"/schema/{id_}")
        return list(schema.get("children", []))

    # -------------------------------------------------------------- queries

    def split_run(
        self, body: dict[str, Any], field: str, values: list[str], names: list[str], chunk: int
    ) -> tuple[pd.DataFrame, Any]:
        """Run `body` over `values` of a recoded field in chunks, halving a chunk on 504."""
        out: list[pd.DataFrame] = []
        last: Any = None
        stack = [values[i : i + chunk] for i in range(0, len(values), chunk)][::-1]
        while stack:
            part = stack.pop()
            recodes = {**body.get("recodes", {}), field: {"map": [[v] for v in part], "total": False}}
            try:
                response = self.table({**body, "recodes": recodes})
            except Timeout504:
                if len(part) == 1:
                    raise
                half = len(part) // 2
                print(f"  504: splitting {len(part)} values", file=sys.stderr)
                stack += [part[half:], part[:half]]
                continue
            out.append(flatten(response, names))
            last = response
        return pd.concat(out, ignore_index=True), last

    def periods(self, b: Benefit) -> list[str]:
        """Every period value id of a date field."""
        valueset = self.children(b.date)[0]["id"]
        kids = self.children(valueset)
        if len(kids) < 100:
            return [k["id"] for k in kids]
        r = self.table(
            {
                "database": f"str:database:{b.db}",
                "measures": [b.count_id],
                "dimensions": [[b.date]],
            }
        )
        return [item["uris"][0] for item in r["fields"][0]["items"]]

    def national_series(self, b: Benefit) -> pd.DataFrame:
        """Caseload and mean award by country (with Abroad and Unknown) for every period."""
        country_valueset = {v["label"]: v["id"] for v in self.children(b.field("COA_CODE"))}["Country"]
        values = [v["id"] for v in self.children(country_valueset)]
        measures = [b.count_id] + ([b.mean_id] if b.mean_id else [])
        geo = b.field("COA_CODE")
        body = {
            "database": f"str:database:{b.db}",
            "measures": measures,
            "recodes": {geo: {"map": [[v] for v in values], "total": True}},
            "dimensions": [[b.date], [geo]],
        }
        df, _ = self.split_run(body, b.date, self.periods(b), ["period", "geo"], 4 if b.freq == "quarterly" else 6)
        return _tidy(df, b, geo_code="geo_code", geo_label="geo_label")

    def _area_field(self, b: Benefit, level: str, codes: list[str]) -> tuple[str, list[str]]:
        if level == "constituency":
            field, valueset = b.field("PCON24"), PCON_VALUESET
        else:
            field, valueset = b.field("COA_CODE"), LA_VALUESET
        return field, [f"{field.replace('str:field:', 'str:value:')}:{valueset}:{code}" for code in codes]

    def _date_value(self, b: Benefit, period: str) -> str:
        return self.children(self.children(b.date)[0]["id"])[0]["id"].rsplit(":", 1)[0] + ":" + period

    def by_area(self, b: Benefit, period: str, level: str, codes: list[str]) -> pd.DataFrame:
        """Caseload and mean award for every area of a level at one period (`YYYYMM`)."""
        field, values = self._area_field(b, level, codes)
        measures = [b.count_id] + ([b.mean_id] if b.mean_id else [])
        body = {
            "database": f"str:database:{b.db}",
            "measures": measures,
            "recodes": {b.date: {"map": [[self._date_value(b, period)]], "total": False}},
            "dimensions": [[b.date], [field]],
        }
        df, _ = self.split_run(body, field, values, ["period", "geo"], 700)
        return _tidy(df, b, geo_code="geo_code", geo_label="geo_label")

    def by_area_age(
        self, b: Benefit, periods: list[str], level: str, codes: list[str], age_field: str, ages: list[str]
    ) -> pd.DataFrame:
        """Caseload and mean award for every area of a level at several periods,
        counting only the `ages` codes of `age_field`'s first valueset, as one group."""
        field, values = self._area_field(b, level, codes)
        age = b.field(age_field)
        valueset = self.children(age)[0]["id"]
        age_values = [f"{valueset.replace('str:valueset:', 'str:value:')}:{a}" for a in ages]
        measures = [b.count_id] + ([b.mean_id] if b.mean_id else [])
        body = {
            "database": f"str:database:{b.db}",
            "measures": measures,
            "recodes": {
                b.date: {"map": [[self._date_value(b, p)] for p in periods], "total": False},
                age: {"map": [age_values], "total": False},
            },
            "dimensions": [[b.date], [field], [age]],
        }
        df, _ = self.split_run(body, field, values, ["period", "geo", "age"], 700)
        return _tidy(df, b, geo_code="geo_code", geo_label="geo_label")

    def by_category(
        self, b: Benefit, period: str, field: str, valueset: str, geo: str, values: list[str]
    ) -> pd.DataFrame:
        """Caseload at one period by each value of `valueset` (a valueset of `field`)
        and each `values` entry of the geography field `geo`, one row per cell.
        `category_code` and `category_label` name the value."""
        categories = [c["id"] for c in self.children(valueset)]
        cat = b.field(field)
        body = {
            "database": f"str:database:{b.db}",
            "measures": [b.count_id],
            "recodes": {
                b.date: {"map": [[self._date_value(b, period)]], "total": False},
                cat: {"map": [[c] for c in categories], "total": False},
            },
            "dimensions": [[b.date], [geo], [cat]],
        }
        df, _ = self.split_run(body, geo, values, ["period", "geo", "category"], 700)
        return pd.DataFrame(
            {
                "benefit_code": BENEFIT_CODE[b.key],
                "period_code": df["period_code"].astype(str),
                "geo_code": df["geo_code"].astype(str),
                "geo_label": df["geo_label"].astype(str),
                "category_code": df["category_code"].astype(str),
                "category_label": df["category_label"].astype(str),
                "caseload": pd.to_numeric(df[b.count_id], errors="coerce"),
            }
        )

    def by_area_category(
        self, b: Benefit, period: str, level: str, codes: list[str], field: str, valueset: str
    ) -> pd.DataFrame:
        geo, values = self._area_field(b, level, codes)
        return self.by_category(b, period, field, valueset, geo, values)

    def by_country_category(self, b: Benefit, period: str, field: str, valueset: str) -> pd.DataFrame:
        geo = b.field("COA_CODE")
        country = {v["label"]: v["id"] for v in self.children(geo)}["Country"]
        return self.by_category(b, period, field, valueset, geo, [v["id"] for v in self.children(country)])


def flatten(response: Any, names: list[str]) -> pd.DataFrame:
    """A Stat-Xplore cube as a long table: one row per cell, `{name}_code`/`_label` per axis."""
    axes = []
    for f in response["fields"]:
        items = []
        for item in f["items"]:
            uris = item.get("uris") or []
            code = uris[0].split(":")[-1] if uris else "TOTAL"
            items.append((code, item["labels"][0]))
        axes.append(items)
    cubes = {m["uri"]: response["cubes"][m["uri"]]["values"] for m in response["measures"]}
    rows = []
    for idx in itertools.product(*[range(len(a)) for a in axes]):
        row: dict[str, Any] = {}
        for name, axis, i in zip(names, axes, idx, strict=True):
            row[f"{name}_code"], row[f"{name}_label"] = axis[i]
        for uri, values in cubes.items():
            x = values
            for i in idx:
                x = x[i]
            row[uri] = x
        rows.append(row)
    return pd.DataFrame(rows)


def _tidy(df: pd.DataFrame, b: Benefit, *, geo_code: str, geo_label: str) -> pd.DataFrame:
    out = pd.DataFrame(
        {
            "benefit": b.key,
            "benefit_code": BENEFIT_CODE[b.key],
            "database": b.db,
            "period_code": df["period_code"].astype(str),
            "period_label": df["period_label"].astype(str),
            "geo_code": df[geo_code].astype(str),
            "geo_label": df[geo_label].astype(str),
            "caseload": pd.to_numeric(df[b.count_id], errors="coerce"),
        }
    )
    if b.mean_id is not None:
        mean = pd.to_numeric(df[b.mean_id], errors="coerce")
        # UC household payment is monthly; convert to a weekly equivalent.
        out["mean_weekly_gbp"] = mean * 12 / 52 if b.amount and b.amount[1] == "monthly" else mean
    else:
        out["mean_weekly_gbp"] = float("nan")
    out.loc[out.caseload.fillna(0) <= 0, "mean_weekly_gbp"] = float("nan")
    return out


def latest_period(series: pd.DataFrame) -> str:
    live = series[(series.caseload.fillna(0) > 0) & (series.geo_code != "TOTAL")]
    return sorted(live.period_code.unique())[-1]


def history_periods(series: pd.DataFrame, freq: str, steps: int) -> list[str]:
    """The latest period and `steps` earlier ones about a quarter apart, ascending.

    Quarterly databases publish irregular months (Feb, May, Aug, Nov, then Mar),
    so their history is the last `steps + 1` published periods. Monthly
    databases step back three months at a time.
    """
    live = sorted(series[(series.caseload.fillna(0) > 0) & (series.geo_code != "TOTAL")].period_code.unique())
    if freq == "quarterly":
        return live[-(steps + 1) :]
    latest = live[-1]
    year, month = int(latest[:4]), int(latest[4:])
    wanted = []
    for k in range(steps, -1, -1):
        total = year * 12 + (month - 1) - 3 * k
        wanted.append(f"{total // 12:04d}{total % 12 + 1:02d}")
    return [p for p in wanted if p in live]


def comparison_period(series: pd.DataFrame, years: int) -> str:
    """The published period nearest to `years` before the latest, the earlier on a tie.

    Quarterly databases moved from February to March snapshots, so the same
    month is not always published; the nearest one is used and named.
    """
    live = sorted(series[(series.caseload.fillna(0) > 0) & (series.geo_code != "TOTAL")].period_code.unique())
    latest = live[-1]
    target = int(latest[:4]) * 12 + int(latest[4:]) - 1 - 12 * years
    return min(live, key=lambda p: (abs(int(p[:4]) * 12 + int(p[4:]) - 1 - target), p))
