import { describe, expect, it } from 'vitest'
import { FiscalYear, Month, fiscalYearOf, isPeriodOfKind } from './period.ts'

describe('periods', () => {
  it('accepts consecutive fiscal years only', () => {
    expect(FiscalYear.safeParse('2024-25').success).toBe(true)
    expect(FiscalYear.safeParse('1999-00').success).toBe(true)
    expect(FiscalYear.safeParse('2024-26').success).toBe(false)
  })

  it('reads an ambiguous string by its declared kind', () => {
    expect(isPeriodOfKind('2010-11', 'fiscal-year')).toBe(true)
    expect(isPeriodOfKind('2010-11', 'month')).toBe(true)
    expect(isPeriodOfKind('2026-03', 'fiscal-year')).toBe(false)
  })

  it('places a month in the fiscal year that starts in April', () => {
    expect(fiscalYearOf(Month.parse('2026-03'))).toBe('2025-26')
    expect(fiscalYearOf(Month.parse('2026-04'))).toBe('2026-27')
    expect(fiscalYearOf(Month.parse('2099-12'))).toBe('2099-00')
  })
})
