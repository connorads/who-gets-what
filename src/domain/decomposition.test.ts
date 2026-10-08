import { describe, expect, it } from 'vitest'
import { z } from 'zod/mini'
import { DecompositionInputsSchema, type DecompositionInputs } from './contract.ts'
import { decompose, logMean } from './decomposition.ts'
import { Basis, type PriceFactors } from './measure.ts'
import { FiscalYear, Month } from './period.ts'
import { readFixture } from './testing/fixtures.ts'

const Effects = z.strictObject({
  from: z.number(),
  to: z.number(),
  change: z.number(),
  population: z.number(),
  claimRate: z.number(),
  awardSize: z.number(),
})

const Golden = z.object({
  from: Month,
  to: Month,
  inputs: DecompositionInputsSchema,
  factors: z.record(FiscalYear, z.strictObject({ realGdp: z.number(), realCpi: z.number() })),
  expected: z.record(Basis, Effects),
})

const golden = Golden.parse(readFixture('decomposition-golden.json'))
const factors = new Map<FiscalYear, PriceFactors>(
  Object.entries(golden.factors).map(([year, f]) => [FiscalYear.parse(year), f]),
)
const months = { from: golden.from, to: golden.to }
const EFFECT_KEYS = ['from', 'to', 'change', 'population', 'claimRate', 'awardSize'] as const

describe('decompose', () => {
  it.each(Basis.options)('matches the golden effects shared with the pipeline (%s)', (basis) => {
    const effects = decompose(golden.inputs, months, basis, factors)
    const expected = golden.expected[basis]

    for (const key of EFFECT_KEYS) {
      expect(effects[key]).toBeCloseTo(expected[key], 3)
    }
  })

  it.each(Basis.options)('splits the change exactly into three effects (%s)', (basis) => {
    const effects = decompose(golden.inputs, months, basis, factors)

    expect(effects.population + effects.claimRate + effects.awardSize).toBeCloseTo(
      effects.change,
      6,
    )
  })

  it('treats neither month as the base: swapping them flips every sign', () => {
    const swapped: DecompositionInputs = {
      population: [golden.inputs.population[1], golden.inputs.population[0]],
      claimants: [golden.inputs.claimants[1], golden.inputs.claimants[0]],
      meanWeeklyAward: [golden.inputs.meanWeeklyAward[1], golden.inputs.meanWeeklyAward[0]],
    }
    const forward = decompose(golden.inputs, months, 'nominal', factors)
    const backward = decompose(swapped, months, 'nominal', factors)

    expect(backward.population).toBeCloseTo(-forward.population, 6)
    expect(backward.claimRate).toBeCloseTo(-forward.claimRate, 6)
    expect(backward.awardSize).toBeCloseTo(-forward.awardSize, 6)
  })

  it('gives no population or claim-rate effect when only the award changes', () => {
    const inputs: DecompositionInputs = {
      population: [1000, 1000],
      claimants: [100, 100],
      meanWeeklyAward: [100, 110],
    }
    const effects = decompose(inputs, months, 'nominal', factors)

    expect(effects.population).toBe(0)
    expect(effects.claimRate).toBe(0)
    expect(effects.awardSize).toBeCloseTo(52_000, 6)
  })
})

describe('logMean', () => {
  it('is the value itself for equal arguments and lies between unequal ones', () => {
    expect(logMean(5, 5)).toBe(5)
    expect(logMean(1, Math.E)).toBeCloseTo(Math.E - 1, 12)
  })
})
