import { describe, expect, it } from 'vitest'
import { decompose } from '#/domain/decomposition.ts'
import { priceFactors } from '#/domain/contract.ts'
import { Month } from '#/domain/period.ts'
import { fixtureCatalogue } from '#/domain/testing/fixtures.ts'
import {
  binAll,
  binEdges,
  binOf,
  colourDomain,
  NO_VALUE,
  parseColour,
  scaleKindOf,
  tokenOf,
} from './colour.ts'
import { formulaText } from './model-formula.ts'
import { waterfallBars } from './waterfall.ts'

describe('colour', () => {
  it('bins magnitudes into six classes over the 2nd to 98th percentile', () => {
    const values = Array.from({ length: 101 }, (_, i) => i)
    const domain = colourDomain(values, 'sequential')

    expect(domain[0]).toBeCloseTo(2)
    expect(domain[1]).toBeCloseTo(98)
    expect(binOf(0, domain, 'sequential')).toBe(0)
    expect(binOf(100, domain, 'sequential')).toBe(5)
    expect(binOf(Number.NaN, domain, 'sequential')).toBe(NO_VALUE)
    expect(binEdges(domain, 'sequential')).toHaveLength(5)
  })

  it('centres differences from the modelled level on a neutral middle class', () => {
    const domain = colourDomain([-300, -10, 0, 12, 90], 'diverging')

    expect(domain[0]).toBe(-domain[1])
    expect(tokenOf(binOf(0, domain, 'diverging'), 'diverging')).toBe('--div-neutral')
    expect(tokenOf(binOf(domain[1], domain, 'diverging'), 'diverging')).toBe('--div-1')
    expect(tokenOf(binOf(domain[0], domain, 'diverging'), 'diverging')).toBe('--div-9')
    expect(Array.from(binAll([Number.NaN], domain, 'diverging'))).toEqual([NO_VALUE])
  })

  it('picks the diverging scale only for actual-less-modelled metrics', () => {
    expect(scaleKindOf('spend-total-vs-model')).toBe('diverging')
    expect(scaleKindOf('spend-total')).toBe('sequential')
  })

  it('reads computed colours', () => {
    expect(parseColour('#c9a35e')).toEqual([201, 163, 94])
    expect(parseColour('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(parseColour('color(srgb 1 0 0.5)')).toEqual([255, 0, 128])
    expect(parseColour('papayawhip')).toBeUndefined()
  })
})

describe('waterfallBars', () => {
  it('stacks the three effects from the start to exactly the end value', () => {
    const catalogue = fixtureCatalogue()
    const entry = catalogue.decomposition.families[0]
    if (entry === undefined) throw new Error('fixture has no decomposition family')
    const inputs = entry.gb.constituency ?? entry.gb['local-authority']
    if (inputs === undefined) throw new Error('fixture family has no GB inputs')
    for (const basis of ['real-gdp', 'real-cpi', 'nominal'] as const) {
      const effects = decompose(
        inputs,
        { from: Month.parse(entry.from), to: Month.parse(entry.to) },
        basis,
        priceFactors(catalogue),
      )
      const bars = waterfallBars(effects, { from: 'From', to: 'To' })

      expect(bars.map((bar) => bar.key)).toEqual([
        'from',
        'population',
        'claimRate',
        'awardSize',
        'to',
      ])
      expect(bars[3]?.end).toBeCloseTo(effects.to, 3)
      for (let i = 2; i < 4; i++) expect(bars[i]?.start).toBe(bars[i - 1]?.end)
    }
  })
})

describe('formulaText', () => {
  it('writes every coefficient with its sign and short label', () => {
    expect(
      formulaText([
        { id: 'intercept', label: 'Intercept', coefficient: -880.1 },
        { id: 'share-aged-66-plus', label: 'Share', coefficient: 9949.53 },
        { id: 'deprivation-decile', label: 'Decile', coefficient: -206.841 },
        { id: 'log-median-pay', label: 'Pay', coefficient: 391.017 },
      ]),
    ).toBe(
      '−£880 + £9,950 × share aged 66 and over − £207 × deprivation decile + £391 × ln(median pay)',
    )
  })
})
