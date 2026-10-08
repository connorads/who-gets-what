/**
 * Values in the reader's price basis. Every file holds nominal pounds; a page
 * carries all three bases and shows the one the reader picks, so a static page
 * can switch basis without a request.
 */
import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import { priceFactors } from '#/domain/contract.ts'
import { applyBasis, type Basis, type Denominator, type PriceFactors } from '#/domain/measure.ts'
import { FiscalYear } from '#/domain/period.ts'
import { formatValue } from '#/lib/format.ts'
import { BASES } from './labels.ts'

export type PerBasis<T> = Readonly<Record<Basis, T>>

/** One figure as text in every basis; `varies` is false when the basis does not apply. */
export interface Figure {
  readonly text: PerBasis<string>
  readonly varies: boolean
}

export function perBasis<T>(make: (basis: Basis) => T): PerBasis<T> {
  return { 'real-gdp': make('real-gdp'), 'real-cpi': make('real-cpi'), nominal: make('nominal') }
}

export type Factors = ReadonlyMap<FiscalYear, PriceFactors>

export function factorsOf(catalogue: Catalogue): Factors {
  return priceFactors(catalogue)
}

/** Whether a metric's values change with the basis: pounds by fiscal year only. */
export function hasBasis(metric: Pick<MetricDefinition, 'unit' | 'periodKind'>): boolean {
  return metric.unit === 'gbp' && metric.periodKind === 'fiscal-year'
}

/** A nominal value in each basis. */
export function inBases(
  value: number,
  metric: Pick<MetricDefinition, 'unit' | 'periodKind'>,
  period: string,
  factors: Factors,
): PerBasis<number> {
  if (!hasBasis(metric)) return perBasis(() => value)
  const year = FiscalYear.parse(period)
  return perBasis((basis) => applyBasis(value, 'gbp', basis, year, factors))
}

export function figure(
  value: number,
  metric: Pick<MetricDefinition, 'unit' | 'periodKind' | 'rateScale'>,
  denominator: Denominator,
  period: string,
  factors: Factors,
  options: { sign?: boolean } = {},
): Figure {
  const values = inBases(value, metric, period, factors)
  const text = perBasis((basis) =>
    formatValue(
      values[basis],
      { unit: metric.unit, rateScale: metric.rateScale, denominator },
      options,
    ),
  )
  return { text, varies: BASES.some((basis) => text[basis] !== text['real-gdp']) }
}

/** A figure that is the same in every basis, such as a count or a share. */
export function plainFigure(text: string): Figure {
  return { text: perBasis(() => text), varies: false }
}
