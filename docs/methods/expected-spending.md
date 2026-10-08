# Spending compared with a modelled level

How an area's spending compares with areas of a similar profile. The
catalogue's `models.expected.method` says the same in plain words, and the
`modelled-comparison` caveat travels with every value.

## Model

One ordinary least squares regression per metric and level, across every
area of the level:

```text
spending per person = intercept
  + b1 x share of residents aged 0 to 15
  + b2 x share of residents aged 66 and over
  + b3 x deprivation decile within the nation (1 is the most deprived tenth)
  + b4 x ln(median annual pay)
  + level for Wales + level for Scotland (England is the reference)
```

| Residual metric | Actual metric | Denominator |
| --- | --- | --- |
| `spend-total-vs-model` | `spend-total` | per resident |
| `spend-pensioner-vs-model` | `spend-pensioner` | per person aged 66 and over |
| `spend-working-age-vs-model` | `spend-working-age` | per person aged 16 to 64 |

- **Period.** Fiscal year 2024-25: spending in 2024-25, population at
  mid-2024, pay in April 2024.
- **Age.** Shares of all residents from the mid-2024 estimates. The share aged
  16 to 64 is close to the remainder, so it is not a term.
- **Deprivation.** Each nation's own index (IoD 2025, WIMD 2025, SIMD 2020),
  as a decile within that nation (ADR 0004 rule 5). The nation levels absorb
  differences between nations that the deciles cannot express.
- **Pay.** ONS Annual Survey of Hours and Earnings, resident analysis:
  median gross annual pay of full-time employees living in the area (Nomis
  `NM_30_1`). ONS withholds it for 2 councils and 6 constituencies.
- **Fit sample.** Areas with every input and a ranked value: small-population,
  partial-coverage and suppressed values are left out of the fit.

## Output

- Every area with every input gets a modelled value. The residual metric is
  actual minus modelled, flagged `modelled`, with series and swarm bundles
  like any metric. Positive is above the modelled level.
- An area missing an input has no modelled value; its dossier names the input
  in `missingInputs`.
- `catalogue.models.expected.fits` publishes, per metric and level, the
  number of areas fitted, R squared, and each term's coefficient and standard
  error, so any value can be recomputed from the inputs.
- The explorer can draw actual against modelled by taking the actual metric's
  series bundle and subtracting the residual bundle.

## Limits

The model describes, it does not explain. Rents, disability prevalence,
household make-up and take-up are not terms, so a residual is not a measure
of need. The pensioner model fits least well (R squared about 0.35 to 0.39):
pensioner spending per person aged 66 and over varies less with these
measures than with State Pension entitlement, which the model cannot see.
