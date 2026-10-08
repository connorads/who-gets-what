import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatMonth,
  formatPounds,
  formatShare,
  formatValue,
  numberFormatOptions,
  ordinal,
  periodLabel,
  shortPeriodLabel,
} from './format.ts'

describe('formatPounds', () => {
  it('scales totals to billions and millions', () => {
    expect(formatPounds(299_004_000_000, { total: true })).toBe('£299.0bn')
    expect(formatPounds(407_924_681, { total: true })).toBe('£407.9m')
    expect(formatPounds(643_922, { total: true })).toBe('£0.64m')
    expect(formatPounds(8_400, { total: true })).toBe('£8,400')
  })

  it('keeps pence only for small per-person values', () => {
    expect(formatPounds(3_275.69)).toBe('£3,276')
    expect(formatPounds(4.9)).toBe('£4.90')
  })

  it('signs differences with a true minus', () => {
    expect(formatPounds(-117, { sign: true })).toBe('−£117')
    expect(formatPounds(40, { sign: true })).toBe('+£40')
  })
})

describe('formatValue', () => {
  const perHead = { unit: 'gbp', denominator: 'per-resident', rateScale: 1 } as const
  const people = { unit: 'people', rateScale: 1000 } as const

  it('formats by unit and denominator', () => {
    expect(formatValue(6527.4, perHead)).toBe('£6,527')
    expect(formatValue(283_611_530_338, { ...perHead, denominator: 'total' })).toBe('£283.6bn')
    expect(formatValue(17_731, { ...people, denominator: 'total' })).toBe('17,731')
    expect(formatValue(929.83, { ...people, denominator: 'per-aged-66-plus' })).toBe('929.8')
    expect(formatValue(0.8839, { unit: 'ratio', denominator: 'total', rateScale: 1 })).toBe('£0.88')
  })

  it('reads a missing value as such and signs differences in every unit', () => {
    expect(formatValue(null, perHead)).toBe('No value')
    expect(formatValue(Number.NaN, perHead)).toBe('No value')
    expect(formatValue(-120, perHead, { sign: true })).toBe('−£120')
    expect(formatValue(12.34, { ...people, denominator: 'per-resident' }, { sign: true })).toBe(
      '+12.3',
    )
  })

  it('gives NumberFlow the same rules', () => {
    expect(numberFormatOptions({ ...perHead, denominator: 'total' })).toMatchObject({
      notation: 'compact',
      currency: 'GBP',
    })
    expect(numberFormatOptions({ ...people, denominator: 'per-resident' })).toEqual({
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
  })
})

describe('periods', () => {
  it('writes months in full or short, and fiscal years as they are', () => {
    expect(periodLabel('2026-03', 'month')).toBe('March 2026')
    expect(periodLabel('2024-25', 'fiscal-year')).toBe('2024-25')
    expect(shortPeriodLabel('2025-09', 'month')).toBe('Sep 25')
    expect(shortPeriodLabel('2024-25', 'fiscal-year')).toBe('2024-25')
  })
})

describe('small formats', () => {
  it('writes ordinals, shares, months and sizes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 592].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '592nd',
    ])
    expect(formatShare(0.842)).toBe('84%')
    expect(formatShare(0.001)).toBe('0.1%')
    expect(formatMonth('2026-03')).toBe('March 2026')
    expect(formatBytes(3_800_000)).toBe('3.8 MB')
  })
})
