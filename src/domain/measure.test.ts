import { describe, expect, it } from 'vitest'
import { ValueFlag, applyBasis, denominatorLabel, perLabel, provenanceKinds } from './measure.ts'
import { FiscalYear } from './period.ts'

const fy = FiscalYear.parse('2024-25')
const factors = new Map([[fy, { realGdp: 1.1, realCpi: 1.2 }]])

describe('applyBasis', () => {
  it('converts money to the requested price basis', () => {
    expect(applyBasis(100, 'gbp', 'real-gdp', fy, factors)).toBeCloseTo(110)
    expect(applyBasis(100, 'gbp', 'real-cpi', fy, factors)).toBeCloseTo(120)
    expect(applyBasis(100, 'gbp', 'nominal', fy, factors)).toBe(100)
  })

  it('leaves counts and ratios alone', () => {
    expect(applyBasis(100, 'people', 'real-gdp', fy, factors)).toBe(100)
    expect(applyBasis(0.93, 'ratio', 'real-cpi', fy, factors)).toBe(0.93)
  })

  it('treats a missing price factor as a defect', () => {
    expect(() => applyBasis(1, 'gbp', 'real-gdp', FiscalYear.parse('2009-10'), factors)).toThrow(
      'No price factors for 2009-10',
    )
  })
})

describe('denominatorLabel', () => {
  it('names the age band in plain words', () => {
    expect(denominatorLabel('per-aged-66-plus', 1)).toBe('per person aged 66 and over')
    expect(denominatorLabel('per-aged-66-plus', 1000)).toBe('per 1,000 people aged 66 and over')
    expect(denominatorLabel('per-resident', 1)).toBe('per resident')
    expect(denominatorLabel('total', 1)).toBe('total')
  })
})

describe('perLabel', () => {
  it('reads the ratio as benefit spending for each £1 of income tax, never as a total', () => {
    expect(perLabel({ unit: 'ratio', rateScale: 1 }, 'total')).toBe('for each £1 of income tax')
    expect(perLabel({ unit: 'gbp', rateScale: 1 }, 'total')).toBe('total')
    expect(perLabel({ unit: 'people', rateScale: 1000 }, 'per-resident')).toBe(
      'per 1,000 residents',
    )
  })
})

describe('provenanceKinds', () => {
  it('reports every derivation a value carries', () => {
    expect(provenanceKinds(0)).toEqual(['measured'])
    expect(provenanceKinds(ValueFlag.harmonised)).toEqual(['measured'])
    expect(provenanceKinds(ValueFlag.apportioned | ValueFlag.survey)).toEqual([
      'apportioned',
      'survey',
    ])
  })
})
