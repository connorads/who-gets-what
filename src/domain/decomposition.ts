/**
 * Change in annual spending split into population, claim-rate and award-size
 * effects (log-mean Divisia index, LMDI-I). The pipeline publishes only the
 * inputs; this is the one calculation, run for the reader's basis. The
 * pipeline's tests run the same maths against
 * `contract/fixtures/decomposition-golden.json`.
 *
 * Annual spending is V = P x R x A x 52, with R = claimants / P. With the
 * logarithmic mean L, each effect is L(V1, V0) x ln(X1 / X0) for its factor X,
 * and the three effects sum exactly to V1 - V0.
 */
import type { DecompositionInputs } from './contract.ts'
import { applyBasis, type Basis, type PriceFactors } from './measure.ts'
import { fiscalYearOf, type FiscalYear, type Month } from './period.ts'

/** Annual pounds in the requested basis. `change` is `to - from`. */
export interface DecompositionEffects {
  readonly from: number
  readonly to: number
  readonly change: number
  readonly population: number
  readonly claimRate: number
  readonly awardSize: number
}

/** (a - b) / (ln a - ln b), and a when a = b. Both must be positive. */
export function logMean(a: number, b: number): number {
  return Math.abs(a - b) <= 1e-12 * Math.max(a, b) ? a : (a - b) / (Math.log(a) - Math.log(b))
}

export function decompose(
  inputs: DecompositionInputs,
  months: { readonly from: Month; readonly to: Month },
  basis: Basis,
  factors: ReadonlyMap<FiscalYear, PriceFactors>,
): DecompositionEffects {
  const [p0, p1] = inputs.population
  const [c0, c1] = inputs.claimants
  const award = (value: number, month: Month): number =>
    applyBasis(value, 'gbp', basis, fiscalYearOf(month), factors)
  const a0 = award(inputs.meanWeeklyAward[0], months.from)
  const a1 = award(inputs.meanWeeklyAward[1], months.to)
  const from = c0 * a0 * 52
  const to = c1 * a1 * 52
  const weight = logMean(to, from)
  return {
    from,
    to,
    change: to - from,
    population: weight * Math.log(p1 / p0),
    claimRate: weight * Math.log(c1 / p1 / (c0 / p0)),
    awardSize: weight * Math.log(a1 / a0),
  }
}
