"""What the site publishes: metrics, sources and caveats.

Copy here is descriptive. It names denominators and sources and never judges
(ADR 0004); tests run the banned-word list over it.
"""

from __future__ import annotations

from dataclasses import dataclass

from wgw_pipeline.canonical.benefits import FAMILIES, PENSIONER_FAMILIES, WORKING_AGE_FAMILIES, family_members

PEOPLE_RATE = 1000

PENSIONER_DENOMINATORS = ("total", "per-resident", "per-aged-66-plus")
WORKING_AGE_DENOMINATORS = ("total", "per-resident", "per-aged-16-64")
ALL_AGES_DENOMINATORS = ("total", "per-resident")

# Population column for each denominator; `total` divides by nothing.
BAND = {
    "per-resident": "total",
    "per-aged-0-15": "aged_0_15",
    "per-aged-16-64": "aged_16_64",
    "per-aged-66-plus": "aged_66_plus",
}


@dataclass(frozen=True)
class Metric:
    id: str
    label: str
    short_label: str
    description: str
    unit: str  # gbp | people | ratio
    kind: str  # spend | caseload | tax | ratio | residual
    codes: tuple[str, ...]
    families: tuple[str, ...]
    denominators: tuple[str, ...]
    default_denominator: str
    provenance: str
    sources: tuple[str, ...]
    caveats: tuple[str, ...]

    @property
    def rate_scale(self) -> int:
        return PEOPLE_RATE if self.unit == "people" else 1

    @property
    def period_kind(self) -> str:
        return "month" if self.kind == "caseload" else "fiscal-year"


def _codes(families: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(b.code for f in families for b in family_members(f))


SPEND_SOURCES = (
    "dwp-benefit-expenditure-local-authority",
    "dwp-benefit-expenditure-constituency",
    "dwp-stat-xplore",
)
SSS_SOURCES = ("sss-adp", "sss-cdp", "sss-padp", "sss-csp")
POPULATION_SOURCES = ("ons-population-local-authority", "ons-population-constituency", "nrs-population-constituency")
SCOTLAND_CAVEATS = ("scotland-harmonised", "scotland-agency-modelled", "scotland-apportioned")
SPEND_CAVEATS = ("spend-scope", "spend-abroad", "constituency-history", "population-denominator")

ALL_FAMILIES = tuple(f.id for f in FAMILIES)
FAMILY_SSS = {
    "attendance-allowance": ("sss-padp",),
    "winter-fuel": ("sss-pawhp",),
    "personal-independence": ("sss-adp",),
    "disability-living": ("sss-cdp",),
    "carers": ("sss-csp",),
}


# A family label that is not a benefit name reads in lower case mid-sentence.
SPEND_NOUN = {"other": "other benefits"}


def _family_denominators(family: str) -> tuple[tuple[str, ...], str]:
    if family in PENSIONER_FAMILIES:
        return PENSIONER_DENOMINATORS, "per-aged-66-plus"
    if family in WORKING_AGE_FAMILIES:
        return WORKING_AGE_DENOMINATORS, "per-aged-16-64"
    return ALL_AGES_DENOMINATORS, "per-resident"


def _family_spend(family_id: str) -> Metric:
    family = next(f for f in FAMILIES if f.id == family_id)
    denominators, default = _family_denominators(family_id)
    caveats = list(SPEND_CAVEATS)
    if family_id in FAMILY_SSS or family_id == "other":
        caveats += SCOTLAND_CAVEATS
    if family_id == "winter-fuel":
        caveats.append("wfp-cost-of-living")
    if family_id == "state-pension":
        caveats.append("orkney-shetland-state-pension")
    if family_id == "carers":
        caveats.append("carers-spend-ages")
    return Metric(
        id=f"spend-{family_id}",
        label=f"Spending on {SPEND_NOUN.get(family_id, family.label)}",
        short_label=family.label,
        description=family.description,
        unit="gbp",
        kind="spend",
        codes=_codes((family_id,)),
        families=(family_id,),
        denominators=denominators,
        default_denominator=default,
        provenance="measured",
        sources=SPEND_SOURCES + FAMILY_SSS.get(family_id, ()) + POPULATION_SOURCES,
        caveats=tuple(caveats),
    )


CLAIMANT_FAMILIES = {
    "state-pension": ("People receiving State Pension", PENSIONER_DENOMINATORS, "per-aged-66-plus"),
    "pension-credit": ("People receiving Pension Credit", PENSIONER_DENOMINATORS, "per-aged-66-plus"),
    "attendance-allowance": (
        "People receiving Attendance Allowance or Pension Age Disability Payment",
        PENSIONER_DENOMINATORS,
        "per-aged-66-plus",
    ),
    "personal-independence": (
        "People receiving Personal Independence Payment or Adult Disability Payment",
        ALL_AGES_DENOMINATORS,
        "per-resident",
    ),
    "universal-credit": ("People aged 16 to 64 on Universal Credit", WORKING_AGE_DENOMINATORS, "per-aged-16-64"),
    "carers": (
        "People aged 16 to 64 receiving Carer's Allowance or Carer Support Payment",
        WORKING_AGE_DENOMINATORS,
        "per-aged-16-64",
    ),
}
# Claimant counts that a per-16-64 rate divides must hold people aged 16 to
# 64 only (ADR 0004 rule 1), so these families count an age-limited code.
CLAIMANT_CODES = {"carers": ("CA_16_64", "CSP_16_64"), "universal-credit": ("UC_16_64",)}


def _claimants(family_id: str) -> Metric:
    label, denominators, default = CLAIMANT_FAMILIES[family_id]
    family = next(f for f in FAMILIES if f.id == family_id)
    codes = CLAIMANT_CODES.get(family_id) or tuple(b.code for b in family_members(family_id) if b.code != "PAWHP")
    caveats = ["claimants-population-year"]
    if family_id in FAMILY_SSS:
        caveats += ["scotland-harmonised", "scotland-apportioned", "scotland-caseload-month"]
    if family_id in ("state-pension", "pension-credit", "attendance-allowance"):
        caveats.append("state-pension-age")
    if family_id == "personal-independence":
        caveats.append("pip-all-ages")
    if family_id == "universal-credit":
        caveats.append("uc-people")
    if family_id == "carers":
        caveats.append("carers-aged-16-64")
    return Metric(
        id=f"claimants-{family_id}",
        label=label,
        short_label=family.label,
        description=f"{label}, in each month with published figures. {family.description}",
        unit="people",
        kind="caseload",
        codes=codes,
        families=(family_id,),
        denominators=denominators,
        default_denominator=default,
        provenance="measured",
        sources=("dwp-stat-xplore", *FAMILY_SSS.get(family_id, ()), *POPULATION_SOURCES),
        caveats=tuple(caveats),
    )


METRICS: tuple[Metric, ...] = (
    Metric(
        id="spend-total",
        label="Benefit spending",
        short_label="All benefits",
        description="All the benefits on this site: pensioner, disability, carer, working-age and housing benefits paid by the Department for Work and Pensions (DWP). In Scotland, it includes the Social Security Scotland benefits that replace some of them.",
        unit="gbp",
        kind="spend",
        codes=_codes(ALL_FAMILIES),
        families=ALL_FAMILIES,
        denominators=ALL_AGES_DENOMINATORS,
        default_denominator="per-resident",
        provenance="measured",
        sources=SPEND_SOURCES + SSS_SOURCES + ("sss-pawhp",) + POPULATION_SOURCES,
        caveats=(
            *SPEND_CAVEATS,
            "uc-history",
            *SCOTLAND_CAVEATS,
            "wfp-cost-of-living",
            "orkney-shetland-state-pension",
        ),
    ),
    Metric(
        id="spend-pensioner",
        label="Spending on pensioner benefits",
        short_label="Pensioner benefits",
        description="State Pension, Pension Credit, Attendance Allowance and winter heating payments, with the Scottish benefits that replace them. Per person figures use people aged 66 and over, the State Pension age.",
        unit="gbp",
        kind="spend",
        codes=_codes(PENSIONER_FAMILIES),
        families=PENSIONER_FAMILIES,
        denominators=PENSIONER_DENOMINATORS,
        default_denominator="per-aged-66-plus",
        provenance="measured",
        sources=(*SPEND_SOURCES, "sss-padp", "sss-pawhp", *POPULATION_SOURCES),
        caveats=SPEND_CAVEATS + SCOTLAND_CAVEATS + ("wfp-cost-of-living", "orkney-shetland-state-pension"),
    ),
    Metric(
        id="spend-working-age",
        label="Spending on working-age benefits",
        short_label="Working-age benefits",
        description="Universal Credit, Employment and Support Allowance, Jobseeker's Allowance, Income Support and Carer's Allowance, with Carer Support Payment in Scotland. Disability benefits are paid at all ages, so they are shown separately.",
        unit="gbp",
        kind="spend",
        codes=_codes(WORKING_AGE_FAMILIES),
        families=WORKING_AGE_FAMILIES,
        denominators=WORKING_AGE_DENOMINATORS,
        default_denominator="per-aged-16-64",
        provenance="measured",
        sources=(*SPEND_SOURCES, "sss-csp", *POPULATION_SOURCES),
        caveats=(*SPEND_CAVEATS, "uc-history", *SCOTLAND_CAVEATS, "working-age-scope", "carers-spend-ages"),
    ),
    *(_family_spend(f.id) for f in FAMILIES),
    *(_claimants(f) for f in CLAIMANT_FAMILIES),
    Metric(
        id="income-tax",
        label="Income tax paid by residents",
        short_label="Income tax",
        description="Income tax paid by people who live in the area, estimated by HMRC from a sample survey. This is income tax only.",
        unit="gbp",
        kind="tax",
        codes=(),
        families=(),
        denominators=ALL_AGES_DENOMINATORS,
        default_denominator="per-resident",
        provenance="survey",
        sources=("hmrc-spi-local-authority", "hmrc-spi-constituency", *POPULATION_SOURCES),
        caveats=("income-tax-only", "income-tax-survey", "population-denominator"),
    ),
    Metric(
        id="spend-to-income-tax",
        label="Benefit spending for each £1 of income tax paid in the same year",
        short_label="Benefits and income tax",
        description="How many pounds of benefits went to people in the area for each £1 of income tax that residents paid in the same year. This is income tax only.",
        unit="ratio",
        kind="ratio",
        codes=_codes(ALL_FAMILIES),
        families=ALL_FAMILIES,
        denominators=("total",),
        default_denominator="total",
        provenance="survey",
        sources=SPEND_SOURCES + SSS_SOURCES + ("sss-pawhp", "hmrc-spi-local-authority", "hmrc-spi-constituency"),
        caveats=(
            "income-tax-only",
            "income-tax-survey",
            "same-year-ratio",
            *SPEND_CAVEATS,
            "uc-history",
            *SCOTLAND_CAVEATS,
        ),
    ),
)

# Spending metrics compared with a modelled level (`compile/models.py`): the
# actual metric and the denominator modelled. Each publishes `{id}-vs-model`.
MODELLED = (
    ("spend-total", "per-resident"),
    ("spend-pensioner", "per-aged-66-plus"),
    ("spend-working-age", "per-aged-16-64"),
)
MODEL_SOURCES = ("iod-2025", "wimd-2025", "simd-2020", "ons-ashe")
BAND_NOUN = {
    "per-resident": "resident",
    "per-aged-66-plus": "person aged 66 and over",
    "per-aged-16-64": "person aged 16 to 64",
}


def _vs_model(base: Metric, denominator: str) -> Metric:
    return Metric(
        id=f"{base.id}-vs-model",
        label=f"{base.label}, compared with the expected level",
        short_label=f"{base.short_label} against expected",
        description=(
            f"Actual spending per {BAND_NOUN[denominator]} minus the level we would expect from the area's ages, "
            "deprivation, typical pay and nation. A figure above zero is above the expected level, and a figure "
            "below zero is below it."
        ),
        unit="gbp",
        kind="residual",
        codes=base.codes,
        families=base.families,
        denominators=(denominator,),
        default_denominator=denominator,
        provenance="modelled",
        sources=base.sources + MODEL_SOURCES,
        caveats=(*base.caveats, "modelled-comparison", "deprivation-within-nation"),
    )


_BASE = {m.id: m for m in METRICS}
METRICS += tuple(_vs_model(_BASE[metric], denominator) for metric, denominator in MODELLED)

DEFAULT_METRIC = "spend-total"


@dataclass(frozen=True)
class Source:
    id: str
    publisher: str
    title: str
    url: str
    licence: str
    cache_source: str
    url_match: str = ""  # regex over cached URLs of `cache_source`; empty matches all
    # Publication date when the download cannot show it: SIMD ranks reach us
    # inside the NRS census index, which is dated by NRS, not by the index.
    published: str | None = None


OGL = "Open Government Licence v3.0"
SOURCES: tuple[Source, ...] = (
    Source(
        "dwp-benefit-expenditure-local-authority",
        "Department for Work and Pensions",
        "Benefit expenditure by local authority, 2024-25",
        "https://assets.publishing.service.gov.uk/media/693ffb536a12691d48491fb3/benefit-expenditure-by-local-authority-2024-25.ods",
        OGL,
        "dwp-spend",
        "local-authority",
    ),
    Source(
        "dwp-benefit-expenditure-constituency",
        "Department for Work and Pensions",
        "Benefit expenditure by parliamentary constituency, 2024-25",
        "https://assets.publishing.service.gov.uk/media/693ffc50c72b0f8ccf33d788/benefit-expenditure-by-parliamentary-constituency-2024-25.ods",
        OGL,
        "dwp-spend",
        "parliamentary-constituency",
    ),
    Source(
        "dwp-outturn-forecast",
        "Department for Work and Pensions",
        "Benefit expenditure and caseload tables: Spring Forecast 2026",
        "https://assets.publishing.service.gov.uk/media/69dcdc56d3e08b8871b66628/outturn-and-forecast-tables-spring-forecast-2026.ods",
        OGL,
        "dwp-outturn",
    ),
    Source(
        "dwp-stat-xplore",
        "Department for Work and Pensions",
        "Stat-Xplore benefit caseloads and awards",
        "https://stat-xplore.dwp.gov.uk/",
        OGL,
        "statxplore",
    ),
    Source(
        "sss-adp",
        "Social Security Scotland",
        "Adult Disability Payment statistics to 31 July 2026",
        "https://www.socialsecurity.gov.scot/publications/2026/09/adult-disability-payment-statistics-to-31-july-2026",
        OGL,
        "sss",
        "adult-disability",
    ),
    Source(
        "sss-cdp",
        "Social Security Scotland",
        "Child Disability Payment statistics to 30 June 2026",
        "https://www.socialsecurity.gov.scot/publications/2026/08/child-disability-payment-statistics-to-30-june-2026",
        OGL,
        "sss",
        "child-disability",
    ),
    Source(
        "sss-padp",
        "Social Security Scotland",
        "Pension Age Disability Payment statistics to 31 July 2026",
        "https://www.socialsecurity.gov.scot/publications/2026/09/pension-age-disability-payment-and-scottish-adult-disability-living-allowance-statistics-to-31-july-2026",
        OGL,
        "sss",
        "pension-age-disability",
    ),
    Source(
        "sss-csp",
        "Social Security Scotland",
        "Carer Support Payment statistics to 30 June 2026",
        "https://www.socialsecurity.gov.scot/publications/2026/08/carer-support-payment-statistics-and-carers-allowance-supplement-statistics-to-30-june-2026",
        OGL,
        "sss",
        "carer-support",
    ),
    Source(
        "sss-pawhp",
        "Social Security Scotland",
        "Winter heating benefits statistics for winter 2025/26",
        "https://www.socialsecurity.gov.scot/publications/2026/05/winter-heating-benefits-statistics-for-winter-2025-2026",
        OGL,
        "sss",
        "winter-heating",
    ),
    Source(
        "ons-population-local-authority",
        "Office for National Statistics",
        "Population estimates by local authority (Nomis NM_2002_1)",
        "https://www.nomisweb.co.uk/datasets/pestsyoala",
        OGL,
        "nomis",
        "NM_2002_1",
    ),
    Source(
        "ons-population-constituency",
        "Office for National Statistics",
        "Population estimates by 2024 parliamentary constituency (Nomis NM_2014_1)",
        "https://www.nomisweb.co.uk/datasets/pestsyoaoa",
        OGL,
        "nomis",
        "NM_2014_1",
    ),
    Source(
        "nrs-population-constituency",
        "National Records of Scotland",
        "Population estimates for other geographies, mid-2011 to mid-2024",
        "https://www.nrscotland.gov.uk/publications/other-geographies-mid-2011-to-mid-2024-2022-data-zones/",
        OGL,
        "nrs",
    ),
    Source(
        "nrs-census-2022-index",
        "National Records of Scotland",
        "Census 2022 output area lookups and population",
        "https://www.nrscotland.gov.uk/publications/2022-census-geography-products",
        OGL,
        "nrs-census",
    ),
    Source(
        "hmrc-spi-local-authority",
        "HM Revenue and Customs",
        "Income and tax by borough and district or unitary authority (Table 3.14)",
        "https://www.gov.uk/government/statistics/income-and-tax-by-borough-and-district-or-unitary-authority-2010-to-2011",
        OGL,
        "hmrc-spi",
        r"3[._-]14",
    ),
    Source(
        "hmrc-spi-constituency",
        "HM Revenue and Customs",
        "Income and tax by parliamentary constituency (Table 3.15)",
        "https://www.gov.uk/government/statistics/income-and-tax-by-parliamentary-constituency-2010-to-2011",
        OGL,
        "hmrc-spi",
        r"3[._-]15",
    ),
    Source(
        "ons-open-geography",
        "Office for National Statistics",
        "Open Geography Portal boundaries and lookups",
        "https://geoportal.statistics.gov.uk/",
        f"{OGL}; contains OS data © Crown copyright and database right",
        "ons-geography",
    ),
    Source(
        "open-innovations-hexmaps",
        "Open Innovations",
        "UK constituency and local authority hex maps",
        "https://open-innovations.org/projects/hexmaps/",
        "MIT License",
        "hexmaps",
    ),
    Source(
        "iod-2025",
        "Ministry of Housing, Communities and Local Government",
        "English indices of deprivation 2025",
        "https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025",
        OGL,
        "deprivation",
        "IoD2025",
    ),
    Source(
        "wimd-2025",
        "Welsh Government",
        "Welsh Index of Multiple Deprivation 2025",
        "https://stats.gov.wales/en-GB/9706edd9-73ad-4902-bb12-7ccd7038626e",
        OGL,
        "deprivation",
        "stats.gov.wales",
    ),
    Source(
        "simd-2020",
        "Scottish Government",
        "Scottish Index of Multiple Deprivation 2020",
        "https://www.gov.scot/collections/scottish-index-of-multiple-deprivation-2020/",
        OGL,
        "nrs-census",
        published="2020-01-28",
    ),
    Source(
        "hmt-gdp-deflator",
        "HM Treasury",
        "GDP deflators at market prices, and money GDP, September 2026",
        "https://www.gov.uk/government/statistics/gdp-deflators-at-market-prices-and-money-gdp-september-2026-quarterly-national-accounts",
        OGL,
        "prices",
        "GDP_Deflators",
    ),
    Source(
        "ons-cpi",
        "Office for National Statistics",
        "CPI index 00: all items (D7BT)",
        "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23",
        OGL,
        "prices",
        "d7bt",
    ),
    Source(
        "ons-ashe",
        "Office for National Statistics",
        "Annual Survey of Hours and Earnings, resident analysis, 2024 (Nomis NM_30_1)",
        "https://www.nomisweb.co.uk/datasets/asher",
        OGL,
        "nomis",
        "NM_30_1",
    ),
    Source(
        "uk-parliament-members",
        "UK Parliament",
        "Members API: current MPs",
        "https://members-api.parliament.uk/",
        "Open Parliament Licence v3.0",
        "parliament",
        "members-api",
    ),
    Source(
        "uk-parliament-election-results",
        "House of Commons Library",
        "Election results: UK general election, 4 July 2024",
        "https://electionresults.parliament.uk/general-elections/6",
        "Open Parliament Licence v3.0",
        "parliament",
        "electionresults",
    ),
)

# Share of Carer's Allowance claimants in England and Wales aged 16 to 64 at the
# latest Stat-Xplore month; a pytest checks it against the compiled caseloads.
CARERS_AGED_16_64_PERCENT = 96
# Share of people on Universal Credit in Great Britain aged 16 to 64 at the
# latest Stat-Xplore month; a pytest checks it the same way.
UC_AGED_16_64_PERCENT = 98

CAVEATS: dict[str, str] = {
    "spend-scope": "Covers the DWP benefits in each group and the Social Security Scotland benefits that replace them. It does not include tax credits, Child Benefit, Cost of Living Payments, Council Tax Benefit (paid until 2012-13) or Discretionary Housing Payments.",
    "spend-abroad": "Money paid to people who live abroad, mostly State Pension, is in DWP's Great Britain totals but not in any area.",
    "uc-history": "Area figures for Universal Credit start in 2019-20. Totals for earlier years leave it out, although DWP paid it from 2013.",
    "constituency-history": "Constituency figures on the 2024 boundaries start in 2018-19. Universal Credit starts in 2019-20 and State Pension in 2023-24. Local authority figures start in 2010-11.",
    "scotland-harmonised": "Scottish figures include the Social Security Scotland benefits that replace DWP benefits: Adult Disability Payment, Child Disability Payment, Pension Age Disability Payment, Carer Support Payment and Pension Age Winter Heating Payment.",
    "scotland-agency-modelled": "DWP's area tables leave out Scotland once a benefit moves to the Scottish Government. While cases moved to Social Security Scotland, DWP kept paying some of them. We estimate those payments from Stat-Xplore counts of people and their payments, scale them to DWP's national totals, and share them between councils as before the move. We work out Carer Support Payment and Pension Age Disability Payment from Scotland's totals and each council's share.",
    "scotland-apportioned": "For benefits that Social Security Scotland pays, each Scottish constituency gets a share of its council's figure, by population at the 2022 census.",
    "scotland-caseload-month": "Scottish counts for these benefits are Social Security Scotland's latest figures, which can be up to four months apart from the DWP month. Earlier months have no Scottish figure.",
    "wfp-cost-of-living": "Area Winter Fuel Payment spending in 2022-23 and 2023-24 includes the Pensioner Cost of Living Payment. From winter 2024 to 2025, Winter Fuel Payment depends on income, and the Scottish figure for 2024-25 is estimated from Pension Credit spending.",
    "orkney-shetland-state-pension": "State Pension spending in Orkney and Shetland is too low in 2023-24 and 2024-25. From August 2023 to August 2024, DWP recorded some people in Shetland with no known area.",
    "working-age-scope": "Personal Independence Payment, Adult Disability Payment and Disability Living Allowance are paid at all ages. The 2024 constituency figures do not split them by age, so they are not in working-age spending.",
    "income-tax-only": "Income tax only. There are no area figures for National Insurance, VAT, council tax or other taxes.",
    "income-tax-survey": "HMRC estimates income tax by area from a sample survey, the Survey of Personal Incomes, based on where taxpayers live. Figures for small areas are less certain, and HMRC does not publish some of them.",
    "same-year-ratio": "Spending and income tax are for the same year. Constituency income tax on the 2024 boundaries is only published for 2023-24.",
    "claimants-population-year": "Rates per 1,000 people use the mid-2024 population estimates, the latest for every area.",
    "state-pension-age": "State Pension age is 66. It rises to 67 between 2026 and 2028. Counts from benefit records can be higher than population estimates.",
    "pip-all-ages": "Personal Independence Payment and Adult Disability Payment are paid at all adult ages, so rates use all residents.",
    "uc-people": f"Counts people aged 16 to 64 on Universal Credit, including partners in joint claims. DWP publishes Universal Credit by age for each area. In Great Britain, {UC_AGED_16_64_PERCENT}% of people on Universal Credit are aged 16 to 64.",
    "carers-aged-16-64": "Counts people aged 16 to 64 only. DWP publishes Carer's Allowance by age for each area. Social Security Scotland publishes Carer Support Payment by age for Scotland as a whole only, so each Scottish council's count uses Scotland's share of carers aged 16 to 64 and is an estimate.",
    "carers-spend-ages": f"Carer's Allowance spending is not split by age for each area, so it includes payments to people aged 65 and over. In England and Wales, {CARERS_AGED_16_64_PERCENT}% of people receiving Carer's Allowance are aged 16 to 64.",
    "election-2024": "Results of the general election on 4 July 2024. Turnout is valid votes as a share of the people registered to vote. The majority is the winner's lead over the second candidate, as votes and as a share of valid votes. By-elections and changes of party since then are not shown. The MP named at the top of the page is the current one.",
    "pip-conditions": "People receiving Personal Independence Payment, by the main condition recorded at their assessment, in the groups DWP uses. Stat-Xplore changes small counts slightly to protect privacy, so the groups can add up to a few people more or less than the area's total. The comparison is with England and Wales, because Scotland has no figures by area.",
    "pip-conditions-scotland": "There is no breakdown by condition for Scottish areas. Adult Disability Payment has replaced Personal Independence Payment in Scotland, and Social Security Scotland publishes conditions for Scotland as a whole only.",
    "population-denominator": "Per person figures for a year use the population estimate for 30 June in the year it starts. For example, 2024-25 uses mid-2024.",
    "modelled-comparison": "The expected level comes from one statistical model across all areas of the same type. It uses ages, deprivation within each nation, typical pay and nation, and the methods page lists its figures. The difference compares an area only with areas that are similar on these measures. Rents, disability, household make-up and how many eligible people claim are not in the model, so the difference does not measure need.",
    "deprivation-within-nation": "England, Wales and Scotland each measure deprivation in their own way, so we compare areas only with others in the same nation. Areas are split into 10 equal groups, from 1, the most deprived tenth, to 10, the least deprived.",
}

DECOMPOSITION_METHOD = (
    "Yearly spending on a benefit is the number of people in its age group, times the share of them claiming, "
    "times the average weekly payment, times 52. We split the change between two months into three parts: "
    "population, the share claiming and the payment size. The split uses the log-mean Divisia index. Each part is "
    "the change in the logarithm of its factor, weighted by the logarithmic mean of the two spending totals. The "
    "parts add up exactly to the change, and neither month is treated as the starting point. Real terms apply each "
    "month's price factor to the payment. Spending here is a yearly rate worked out from Stat-Xplore counts and "
    "payments, not the amount paid out. Population after mid-2024 stays at the mid-2024 figure, so later "
    "population growth shows in the share claiming. Scottish areas are left out of benefits that Social Security "
    "Scotland now pays, and Universal Credit counts households."
)

EXPECTED_METHOD = (
    "The expected level comes from an ordinary least squares regression across every area of the same type. It "
    "predicts spending per person in the benefit's age group from the share of residents aged 0 to 15, the share "
    "aged 66 and over, the area's deprivation decile within its own nation, the natural logarithm of median yearly "
    "pay for full-time employees who live there, and whether the area is in Wales or Scotland. An area is included "
    "when it has every input and a ranked value. The published difference is actual spending minus expected "
    "spending. Areas missing an input have no expected level, and their page says which input is missing."
)

# Inputs to the models and the neighbour profile: label, period and sources.
MODEL_INPUTS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "share-aged-0-15": ("Share of residents aged 0 to 15", "mid-2024", POPULATION_SOURCES),
    "share-aged-66-plus": ("Share of residents aged 66 and over", "mid-2024", POPULATION_SOURCES),
    "deprivation-decile": (
        "Deprivation decile within the nation, from 1, the most deprived tenth, to 10",
        "2025 (England and Wales), 2020 (Scotland)",
        ("iod-2025", "wimd-2025", "simd-2020"),
    ),
    "median-pay": (
        "Median yearly pay before tax of full-time employees who live in the area",
        "April 2024",
        ("ons-ashe",),
    ),
    "population-density": (
        "Residents per square kilometre of land",
        "mid-2024",
        (*POPULATION_SOURCES, "ons-open-geography"),
    ),
}

NEIGHBOURS_METHOD = (
    "Similar areas are the areas of the same type, anywhere in Great Britain, with the most similar profile. The "
    "profile has five measures: the share of residents aged 0 to 15, the share aged 66 and over, the deprivation "
    "decile within the area's own nation, the natural logarithm of median yearly pay, and the natural logarithm of "
    "residents per square kilometre. We rescale each measure to a mean of 0 and a standard deviation of 1 across "
    "areas of that type, then rank areas by straight-line distance across the five. When an area has a measure "
    "missing, the distance uses the others and is scaled up to five. Similar areas share a profile, not a place "
    "or a level of spending."
)
