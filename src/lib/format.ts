/**
 * Number and period formatting for every surface: pages, tables, share cards
 * and the explorer. One function per kind of figure, so a value reads the
 * same everywhere it appears, each beside its denominator and price basis.
 */
import type { Denominator, RateScale, Unit } from '#/domain/measure.ts'
import type { PeriodKind } from '#/domain/period.ts'

/** What `formatValue` needs to know about a metric's value. */
export interface ValueFormat {
  readonly unit: Unit
  readonly denominator: Denominator
  readonly rateScale: RateScale
}

const MINUS = '−'

const grouped = (value: number, digits = 0): string =>
  value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const signed = (text: string, value: number, sign: boolean): string =>
  value < 0 ? `${MINUS}${text}` : sign && value > 0 ? `+${text}` : text

/** Pounds: £299.0bn, £407.9m, £0.64m, £8,400 for totals; £3,276 or £4.90 per person. */
export function formatPounds(value: number, options: { total?: boolean; sign?: boolean } = {}) {
  const size = Math.abs(value)
  const sign = options.sign ?? false
  if (options.total === true) {
    if (size >= 1e9) return signed(`£${grouped(size / 1e9, 1)}bn`, value, sign)
    if (size >= 1e6) return signed(`£${grouped(size / 1e6, 1)}m`, value, sign)
    if (size >= 1e4) return signed(`£${grouped(size / 1e6, 2)}m`, value, sign)
    return signed(`£${grouped(size)}`, value, sign)
  }
  return signed(`£${grouped(size, size < 10 ? 2 : 0)}`, value, sign)
}

/** A total from `formatPounds` written for a sentence: £430.1m reads £430.1 million. */
export function moneyInWords(text: string): string {
  return text.replace(/(\d)bn$/, '$1 billion').replace(/(\d)m$/, '$1 million')
}

export function formatCount(value: number, sign = false): string {
  return signed(grouped(Math.abs(Math.round(value))), value, sign)
}

/**
 * One value of a metric for its unit and denominator: pounds, a count, a
 * rate per 1,000 people to one decimal, or a ratio as pounds and pence for
 * each £1, such as £0.88. `sign` marks
 * differences with + and a true minus; a missing value reads `No value`.
 */
export function formatValue(
  value: number | null | undefined,
  format: ValueFormat,
  options: { sign?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No value'
  const sign = options.sign ?? false
  if (format.unit === 'ratio') return signed(`£${grouped(Math.abs(value), 2)}`, value, sign)
  if (format.unit === 'people') {
    return format.denominator === 'total'
      ? formatCount(value, sign)
      : signed(grouped(Math.abs(value), 1), value, sign)
  }
  return formatPounds(value, { total: format.denominator === 'total', sign })
}

/** The Intl options NumberFlow accepts: it has no engineering or scientific notation. */
export interface FlowFormat {
  readonly style?: 'currency'
  readonly currency?: string
  readonly notation?: 'compact' | 'standard'
  readonly minimumFractionDigits?: number
  readonly maximumFractionDigits?: number
}

/** NumberFlow options for a unit: currency, compact for totals. */
export function numberFormatOptions(format: ValueFormat): FlowFormat {
  if (format.unit === 'gbp') {
    return format.denominator === 'total'
      ? {
          style: 'currency',
          currency: 'GBP',
          notation: 'compact',
          maximumFractionDigits: 1,
        }
      : { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }
  }
  if (format.unit === 'ratio') {
    return {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  }
  return format.denominator === 'total'
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 1, maximumFractionDigits: 1 }
}

/**
 * A share from 0 to 1 as a percentage: whole by default, with one decimal
 * under 1%; `digits` fixes the decimals, as election results print them.
 */
export function formatShare(share: number, digits?: number): string {
  const percent = share * 100
  return `${grouped(percent, digits ?? (percent > 0 && percent < 1 ? 1 : 0))}%`
}

export function ordinal(n: number): string {
  const tens = n % 100
  const ones = n % 10
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : ones === 1
        ? 'st'
        : ones === 2
          ? 'nd'
          : ones === 3
            ? 'rd'
            : 'th'
  return `${grouped(n)}${suffix}`
}

const monthDate = (month: string): Date | undefined => {
  const [year, m] = month.split('-').map(Number)
  if (year === undefined || m === undefined || Number.isNaN(year) || Number.isNaN(m)) {
    return undefined
  }
  return new Date(Date.UTC(year, m - 1, 1))
}

/** `2026-03` as `March 2026`. */
export function formatMonth(month: string): string {
  return (
    monthDate(month)?.toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }) ?? month
  )
}

/** A period as readers write it: fiscal years as they are, months as `March 2026`. */
export function periodLabel(period: string, kind: PeriodKind): string {
  return kind === 'month' ? formatMonth(period) : period
}

/** A period for a narrow axis: fiscal years as they are, months as `Mar 26`. */
export function shortPeriodLabel(period: string, kind: PeriodKind): string {
  if (kind === 'fiscal-year') return period
  const date = monthDate(period)
  if (date === undefined) return period
  const month = date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3)
  return `${month} ${period.slice(2, 4)}`
}

/** An ISO date as `4 July 2024`. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${grouped(bytes / 1e6, 1)} MB`
  if (bytes >= 1e3) return `${grouped(bytes / 1e3, 0)} kB`
  return `${grouped(bytes)} bytes`
}
