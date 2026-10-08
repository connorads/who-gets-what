/**
 * Waterfall bars for a change decomposition: the starting run rate, the
 * population, claim-rate and award-size effects stacked from it, and the end
 * run rate. Each effect bar starts where the previous one ended, so the bars
 * add up to the change by construction; a test holds that.
 */
import type { DecompositionEffects } from '#/domain/decomposition.ts'

export type WaterfallKey = 'from' | 'population' | 'claimRate' | 'awardSize' | 'to'

export interface WaterfallBar {
  readonly key: WaterfallKey
  readonly label: string
  /** Running totals at the bar's two ends; `from` and `to` bars start at zero. */
  readonly start: number
  readonly end: number
  readonly kind: 'total' | 'effect'
}

export const EFFECT_LABEL = {
  population: 'Population',
  claimRate: 'Share claiming',
  awardSize: 'Payment size',
} as const

export function waterfallBars(
  effects: DecompositionEffects,
  labels: { readonly from: string; readonly to: string },
): readonly WaterfallBar[] {
  const afterPopulation = effects.from + effects.population
  const afterClaimRate = afterPopulation + effects.claimRate
  return [
    { key: 'from', label: labels.from, start: 0, end: effects.from, kind: 'total' },
    {
      key: 'population',
      label: EFFECT_LABEL.population,
      start: effects.from,
      end: afterPopulation,
      kind: 'effect',
    },
    {
      key: 'claimRate',
      label: EFFECT_LABEL.claimRate,
      start: afterPopulation,
      end: afterClaimRate,
      kind: 'effect',
    },
    {
      key: 'awardSize',
      label: EFFECT_LABEL.awardSize,
      start: afterClaimRate,
      end: afterClaimRate + effects.awardSize,
      kind: 'effect',
    },
    { key: 'to', label: labels.to, start: 0, end: effects.to, kind: 'total' },
  ]
}
