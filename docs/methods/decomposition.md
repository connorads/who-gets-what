# Change decomposition

What changed a benefit's annual spending between two months: more eligible
people, a larger share of them claiming, or larger awards. The catalogue's
`decomposition.method` states the same rules in plain words for the methods
page.

## Identity

Annual run-rate spending is

```text
V = P x R x A x 52
```

- `P` is the eligible population: the age band the benefit serves (ADR 0004
  rule 1). Pensioner benefits use people aged 66 and over, working-age
  benefits people aged 16 to 64, and all-age benefits all residents.
- `R = claimants / P` is the claim rate. Universal Credit counts households,
  because only household payments have a mean award.
- `A` is the mean weekly award from Stat-Xplore.

## Split

The log-mean Divisia index (LMDI-I) splits `V1 - V0` into three effects. With
the logarithmic mean `L(a, b) = (a - b) / (ln a - ln b)` and `L(a, a) = a`:

```text
population effect = L(V1, V0) x ln(P1 / P0)
claim-rate effect = L(V1, V0) x ln(R1 / R0)
award-size effect = L(V1, V0) x ln(A1 / A0)
```

The effects sum exactly to the change, with no residual term. Swapping the
two months flips every sign, so neither month is the base.

Real terms multiply each month's award by the price factor of the fiscal year
the month falls in (`fiscalYearOf`). The basis changes the award-size effect
and, through `L`, the size of the other two.

## Data

| Family | Benefit counted | Eligible population |
| --- | --- | --- |
| `state-pension`, `pension-credit`, `attendance-allowance` | `SP`, `PC`, `AA` | aged 66 and over |
| `personal-independence`, `disability-living`, `housing-benefit` | `PIP`, `DLA`, `HB` | all residents |
| `carers` | `CA_16_64` (aged 16 to 64) | aged 16 to 64 |
| `universal-credit` | `UC_HH` (households) | aged 16 to 64 |
| `employment-support`, `jobseekers` | `ESA`, `JSA` | aged 16 to 64 |

- **Months.** `to` is the latest Stat-Xplore month for the benefit. `from` is
  the published month nearest to three years earlier, the earlier one on a
  tie (`comparison_period`). Quarterly databases moved from February to March
  snapshots, so `from` can be one month off the same month.
- **Population.** Each month uses the mid-year estimate of its own year, held
  at mid-2024, the latest for every area. Growth after mid-2024 therefore
  appears in the claim-rate effect.
- **Scotland.** Areas are left out of a family that Social Security Scotland
  now pays (Attendance Allowance, PIP, DLA and Carer's Allowance): its
  caseloads have no mean award, and DWP's Scottish counts at the earlier month
  are not comparable. The catalogue lists the nations each family covers.
- **GB.** GB inputs, per level, sum population and claimants over the areas
  with every input, and weight the award by claimants.
- **Run rate, not outturn.** Spending here is caseload times award. It
  differs from DWP outturn most for Housing Benefit, ESA and JSA, which are
  moving to Universal Credit.

## Where it lives

- Inputs: `catalogue.decomposition` (months, band, nations, GB inputs), each
  dossier's `decomposition` and the `decomposition/{level}/{family}.bin`
  bundles for every area.
- Maths: `decompose` in `src/domain/decomposition.ts` for the app, and
  `effects` in `pipeline/src/wgw_pipeline/compile/decomposition.py` for tests.
  Both match `contract/fixtures/decomposition-golden.json`.
