import { z } from 'zod/mini'

const isConsecutiveYears = (value: string): boolean => {
  const start = Number(value.slice(0, 4))
  const end = Number(value.slice(5, 7))
  return (start + 1) % 100 === end
}

/** A UK fiscal year, April to March, written `2024-25`. */
export const FiscalYear = z
  .string()
  .check(z.regex(/^\d{4}-\d{2}$/), z.refine(isConsecutiveYears))
  .brand<'FiscalYear'>()
export type FiscalYear = z.infer<typeof FiscalYear>

/** A monthly snapshot (caseloads, awards), written `2026-03`. */
export const Month = z
  .string()
  .check(z.regex(/^\d{4}-(?:0[1-9]|1[0-2])$/))
  .brand<'Month'>()
export type Month = z.infer<typeof Month>

/**
 * `2010-11` reads as a fiscal year and as November 2010, so a period string is
 * never parsed alone: every list of periods travels with its kind.
 */
export const PeriodKind = z.enum(['fiscal-year', 'month'])
export type PeriodKind = z.infer<typeof PeriodKind>

export function isPeriodOfKind(value: string, kind: PeriodKind): boolean {
  return kind === 'fiscal-year'
    ? FiscalYear.safeParse(value).success
    : Month.safeParse(value).success
}

/** The fiscal year a month falls in. Deflators are published per fiscal year. */
export function fiscalYearOf(month: Month): FiscalYear {
  const year = Number(month.slice(0, 4))
  const start = Number(month.slice(5, 7)) >= 4 ? year : year - 1
  return FiscalYear.parse(`${start}-${String((start + 1) % 100).padStart(2, '0')}`)
}

/** Mid-year population estimate reference, written `mid-2024`. */
export const MidYear = z
  .string()
  .check(z.regex(/^mid-\d{4}$/))
  .brand<'MidYear'>()
export type MidYear = z.infer<typeof MidYear>
