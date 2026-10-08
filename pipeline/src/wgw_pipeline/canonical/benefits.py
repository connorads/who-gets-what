"""Benefits and benefit families.

A family pairs a DWP benefit with its Social Security Scotland replacement, so
devolution never shows as a fall in Scottish spending. Only top-level codes are
family members; sub-rows (PIP under 65, DLA by age) refine a member and are
never added to it.
"""

from __future__ import annotations

from dataclasses import dataclass

ENGLAND_WALES_SCOTLAND = ("england", "wales", "scotland")


@dataclass(frozen=True)
class Benefit:
    code: str
    label: str
    family: str | None
    administrator: str
    nations: tuple[str, ...] = ENGLAND_WALES_SCOTLAND
    from_fy: str | None = None
    to_fy: str | None = None
    parent: str | None = None
    # First fiscal year (start year) in which the DWP area tables exclude Scotland.
    devolved_from: int | None = None


BENEFITS: tuple[Benefit, ...] = (
    Benefit("SP", "State Pension", "state-pension", "DWP"),
    Benefit("PC", "Pension Credit", "pension-credit", "DWP"),
    Benefit("AA", "Attendance Allowance", "attendance-allowance", "DWP", devolved_from=2020),
    Benefit("PADP", "Pension Age Disability Payment", "attendance-allowance", "SSS", ("scotland",), "2024-25"),
    Benefit("WFP", "Winter Fuel Payment", "winter-fuel", "DWP", devolved_from=2024),
    Benefit("PAWHP", "Pension Age Winter Heating Payment", "winter-fuel", "SSS", ("scotland",), "2024-25"),
    Benefit("PIP", "Personal Independence Payment", "personal-independence", "DWP", devolved_from=2020),
    Benefit("PIP_U65", "Personal Independence Payment, under 65", None, "DWP", parent="PIP", devolved_from=2020),
    Benefit("PIP_65PLUS", "Personal Independence Payment, 65 and over", None, "DWP", parent="PIP", devolved_from=2020),
    Benefit("ADP", "Adult Disability Payment", "personal-independence", "SSS", ("scotland",), "2022-23"),
    Benefit("DLA", "Disability Living Allowance", "disability-living", "DWP", devolved_from=2020),
    Benefit("DLA_CHILD", "Disability Living Allowance, children", None, "DWP", parent="DLA", devolved_from=2020),
    Benefit("DLA_WA", "Disability Living Allowance, working age", None, "DWP", parent="DLA", devolved_from=2020),
    Benefit("DLA_PA", "Disability Living Allowance, pension age", None, "DWP", parent="DLA", devolved_from=2020),
    Benefit("CDP", "Child Disability Payment", "disability-living", "SSS", ("scotland",), "2021-22"),
    Benefit("CA", "Carer's Allowance", "carers", "DWP", devolved_from=2019),
    Benefit("CA_16_64", "Carer's Allowance, aged 16 to 64", None, "DWP", parent="CA", devolved_from=2019),
    Benefit("CSP", "Carer Support Payment", "carers", "SSS", ("scotland",), "2023-24"),
    Benefit("CSP_16_64", "Carer Support Payment, aged 16 to 64", None, "SSS", ("scotland",), "2023-24", parent="CSP"),
    Benefit("UC", "Universal Credit", "universal-credit", "DWP"),
    Benefit("UC_16_64", "Universal Credit, aged 16 to 64", None, "DWP", parent="UC"),
    Benefit("HB", "Housing Benefit", "housing-benefit", "DWP"),
    Benefit("ESA", "Employment and Support Allowance", "employment-support", "DWP"),
    Benefit("JSA", "Jobseeker's Allowance", "jobseekers", "DWP"),
    Benefit("IS", "Income Support", "income-support", "DWP"),
    Benefit("IS_MIG", "Income Support, Minimum Income Guarantee", None, "DWP", parent="IS"),
    Benefit("IS_INCAP", "Income Support, incapacity", None, "DWP", parent="IS"),
    Benefit("IS_CARER", "Income Support, carer", None, "DWP", parent="IS"),
    Benefit("IS_LP", "Income Support, lone parent", None, "DWP", parent="IS"),
    Benefit("IS_OTHER", "Income Support, others", None, "DWP", parent="IS"),
    Benefit("BB", "Bereavement Benefit and Widow's Benefit", "other", "DWP"),
    Benefit("IB", "Incapacity Benefit", "other", "DWP"),
    Benefit("SDA", "Severe Disablement Allowance", "other", "DWP", devolved_from=2020),
    Benefit("SDA_WA", "Severe Disablement Allowance, working age", None, "DWP", parent="SDA", devolved_from=2020),
    Benefit("SDA_PA", "Severe Disablement Allowance, pension age", None, "DWP", parent="SDA", devolved_from=2020),
    # Outside every family: localised in April 2013 (CTB) or discretionary and
    # council-run (DHP). Kept in the fact table, never in a total.
    Benefit("CTB", "Council Tax Benefit", None, "DWP"),
    Benefit("DHP", "Discretionary Housing Payments", None, "DWP", devolved_from=2017),
    # Caseload-only measure.
    Benefit("UC_HH", "Universal Credit households", None, "DWP"),
)

BY_CODE = {b.code: b for b in BENEFITS}


@dataclass(frozen=True)
class Family:
    id: str
    label: str
    description: str


FAMILIES: tuple[Family, ...] = (
    Family(
        "state-pension",
        "State Pension",
        "The State Pension, paid from State Pension age. It includes the new State Pension and the older basic and additional pensions.",
    ),
    Family("pension-credit", "Pension Credit", "Extra money for people over State Pension age who have a low income."),
    Family(
        "attendance-allowance",
        "Attendance Allowance and Pension Age Disability Payment",
        "Help for people over State Pension age whose disability means they need care. In Scotland, Pension Age Disability Payment replaces Attendance Allowance.",
    ),
    Family(
        "winter-fuel",
        "Winter Fuel Payment and Pension Age Winter Heating Payment",
        "A yearly payment to help people over State Pension age with heating costs. In Scotland, Pension Age Winter Heating Payment replaces Winter Fuel Payment.",
    ),
    Family(
        "personal-independence",
        "Personal Independence Payment and Adult Disability Payment",
        "Help with the extra costs of a long-term health condition or disability. In Scotland, Adult Disability Payment replaces Personal Independence Payment.",
    ),
    Family(
        "disability-living",
        "Disability Living Allowance and Child Disability Payment",
        "Disability Living Allowance for children, and for adults who claimed it before Personal Independence Payment began. In Scotland, Child Disability Payment replaces it for children.",
    ),
    Family(
        "carers",
        "Carer's Allowance and Carer Support Payment",
        "Money for people who care for a disabled person for at least 35 hours a week. In Scotland, Carer Support Payment replaces Carer's Allowance.",
    ),
    Family(
        "universal-credit",
        "Universal Credit",
        "Help with living costs for working-age people on a low income, in or out of work.",
    ),
    Family(
        "housing-benefit",
        "Housing Benefit",
        "Help with rent. Most people who get it now are pensioners or live in supported housing.",
    ),
    Family(
        "employment-support",
        "Employment and Support Allowance",
        "Money for people whose illness or disability limits how much they can work.",
    ),
    Family(
        "jobseekers",
        "Jobseeker's Allowance",
        "Money for people looking for work, based on the National Insurance they have paid.",
    ),
    Family(
        "income-support",
        "Income Support",
        "An older benefit for people on a low income. Universal Credit has mostly replaced it.",
    ),
    Family("other", "Other benefits", "Bereavement Benefit, Incapacity Benefit and Severe Disablement Allowance."),
)

FAMILY_IDS = tuple(f.id for f in FAMILIES)
PENSIONER_FAMILIES = ("state-pension", "pension-credit", "attendance-allowance", "winter-fuel")
WORKING_AGE_FAMILIES = ("universal-credit", "employment-support", "jobseekers", "income-support", "carers")


def family_members(family: str) -> list[Benefit]:
    return [b for b in BENEFITS if b.family == family]
