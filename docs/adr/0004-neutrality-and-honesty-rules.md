# Neutrality and honesty rules for every number the site shows

The site describes; it does not judge. These rules bind the pipeline, the
data contract, page copy, charts, OG images and any future MCP output. Tests
enforce each rule that a machine can check.

## Rules

1. **Denominators match the age band a benefit serves.** Pensioner benefits
   are per person aged 66 and over (caseloads per 1,000 aged 66 and over).
   Working-age benefits are per person aged 16 to 64, and child benefits per
   person aged 0 to 15. Per resident and total are offered and labelled. An
   all-ages count is never divided by a working-age band: about 20% of PIP
   claimants are 65 or over.
2. **Every chart, table and sentence names its denominator**, using
   `denominatorLabel` in `src/domain/measure.ts`.
3. **Real terms by default.** Money shows 2026-27 prices using the GDP deflator
   (as DWP and OBR do). CPI and nominal are one toggle away. The basis and
   price year appear beside every money figure.
4. **Income tax is labelled "income tax only".** A ratio of benefit spend to
   income tax pairs the same fiscal year. The site never says "net
   contributor" or "net recipient": there are no area figures for National
   Insurance, VAT or council tax.
5. **Deprivation is shown within each nation.** The English, Welsh and
   Scottish indices are separate, so deciles rank areas against their own
   nation and name the index.
6. **Derived values are flagged.** Apportioned, modelled and survey values
   carry flags from the pipeline to the pixel: a halftone fill on charts and a
   chip in text and tables.
7. **Scotland is harmonised, not dropped.** Social Security Scotland benefits
   join their DWP equivalents in one benefit family: ADP with PIP, PADP with
   Attendance Allowance, CDP with child DLA, Carer Support Payment with Carer's
   Allowance, Pension Age Winter Heating Payment with Winter Fuel Payment. A
   family uses DWP figures for England and Wales and Social Security Scotland
   figures for Scotland, never both for the same benefit and month. Council
   figures apportioned to constituencies carry the apportioned flag. Every
   devolved-benefit chart shows which nations each period covers. Northern
   Ireland is labelled as not covered.
8. **Small populations are not ranked.** An area whose denominator band holds
   fewer than 1,000 people gets the small-population flag and no rank.
9. **Comparisons, not judgements.** Templated copy compares ("higher than 82%
   of constituencies"). Party appears as text, never as a colour.

## Banned words

Generated and editorial copy never uses these words or phrases, matched
case-insensitively as whole words:

burden, drain, bloated, handout, scrounger, skiver, freeloader, dependency
culture, welfare dependency, generous, overgenerous, lavish, stingy, meagre,
paltry, soaring, skyrocketing, exploding, spiralling, ballooning, out of
control, crisis, unsustainable, unaffordable, fair share, deserving,
undeserving, net contributor, net recipient, subsidise, subsidised, pays its
way, taxpayers' money, hard-working taxpayers, merely.

The list lives in `contract/neutrality/banned-words.json`. A Vitest test runs
it over every template and every prerendered page, and pytest runs it over
pipeline copy.

## Alternatives considered

- **"Per eligible person" as the default denominator.** Area data has no
  count of people who are eligible but do not claim, so the measure cannot be
  built.
- **Total or per-resident spend as the only measure.** The leader changes with
  the denominator: Brent East on total, Clacton per resident, Liverpool
  Riverside per person aged 66 and over, Liverpool Walton per person aged 16 to
  64. 37% of constituencies move more than 200 places across the per-head
  measures, and per-resident spend mostly measures age.
- **Nominal pounds only.** Over 15 years, nominal series mostly show inflation
  and the triple lock.
- **DWP data alone for Scotland.** Scotland then looks lowest (£3,591 per
  resident against £4,145 for England) only because devolved benefits are
  missing: DWP shows 919 Scottish PIP claimants where Social Security Scotland
  pays ADP to 510,150 people.
- **Greying Scotland out until later.** The Social Security Scotland files are
  already local and ADP is parsed, so merging costs little more than greying
  out and keeps Scotland's 57 constituencies and 32 councils in every
  comparison.
- **Benefit spend against income tax across different years.** Pairing DWP
  2024-25 with tax 2023-24 inflates every ratio by about 0.1 and flips the GB
  headline from 0.93 to 1.04.
