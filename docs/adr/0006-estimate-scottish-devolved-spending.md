# Estimate Scottish devolved spending that no source publishes by area

ADR 0004 merges Social Security Scotland benefits into GB benefit families.
For spending, that merge has a gap. Once a benefit is devolved, DWP's area
tables leave Scotland out: Carer's Allowance from 2019-20, Attendance
Allowance, Disability Living Allowance, PIP and Severe Disablement Allowance
from 2020-21, Winter Fuel Payment from 2024-25. Yet DWP kept paying most of
these Scottish cases under agency agreements until each transfer to Social
Security Scotland finished, in 2025 for most. Neither source publishes that
spending by area.

The pipeline fills the gap with estimates, flagged as modelled:

- **Agency payments** (AA, DLA, PIP, CA). The Stat-Xplore run rate for
  Scotland (caseload x mean weekly award x 52, averaged over the year's
  published months), times the ratio of DWP outturn to the same run rate in
  England and Wales that year. Councils get their share of Scottish spending
  in the last full year before devolution.
- **Severe Disablement Allowance.** Scotland's last DWP year, scaled by the
  England and Wales trend.
- **Social Security Scotland.** ADP and CDP payments by council and fiscal
  year are used as published. PADP is Scotland's monthly payments, shared by
  each council's all-time payments. CSP is monthly caseload in payment at the
  Carer's Allowance rate, shared by council caseload. Pension Age Winter
  Heating Payment for winter 2024/25 is each council's Pension Credit spending
  times the England and Wales ratio of Winter Fuel Payment to Pension Credit,
  because both went to the same group that winter.

Constituency values for every Scottish devolved figure are council values
split by census 2022 population and carry the apportioned flag. Caseloads use
Social Security Scotland counts only, so no claim is counted twice.

## Consequences

- Scotland is complete for every spending metric in every year, and its
  values are ranked with the rest of GB.
- The model is checked where an answer exists: the 2019-20 Scotland estimate
  is within 0.1% of DWP outturn for AA, DLA and PIP, and the Wales estimate
  is within 3% in every year. `pnpm run data:test` fails if that drifts.
- Every estimate carries the modelled flag and the `scotland-agency-modelled`
  caveat, so the site shows it as an estimate.

## Alternatives considered

- **Social Security Scotland figures only.** Scottish disability, carer and
  pensioner disability spending for 2020-21 and 2021-22 would be close to
  nil, and 2022-23 to 2024-25 would miss £2bn to £3.5bn a year while cases
  moved.
- **Flag the years as partial coverage and leave them out of ranks.** Honest
  but drops Scotland from the main comparisons for five years, which ADR 0004
  set out to avoid.
- **Split a Scotland total by population.** Ignores that need differs by
  council; the pre-devolution council shares keep each council's own pattern.
