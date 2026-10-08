import { z } from 'zod/mini'
import type { FiscalYear } from './period.ts'

/** Stable metric identifier from the metric catalogue, e.g. `spend-pensioner`. */
export const MetricId = z
  .string()
  .check(z.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))
  .brand<'MetricId'>()
export type MetricId = z.infer<typeof MetricId>

/**
 * `gbp` values are nominal pounds in every data file; `people` are claimant
 * counts; `ratio` is unitless (for example DWP spend over income tax).
 */
export const Unit = z.enum(['gbp', 'people', 'ratio'])
export type Unit = z.infer<typeof Unit>

/**
 * Each per-head denominator is the population in the age band the benefit
 * serves. There is no "per eligible person": area data has no count of people
 * who are eligible but not claiming.
 */
export const Denominator = z.enum([
  'total',
  'per-resident',
  'per-aged-0-15',
  'per-aged-16-64',
  'per-aged-66-plus',
])
export type Denominator = z.infer<typeof Denominator>

/** `people` metrics are rates per 1,000; `gbp` metrics are per person. */
export const RateScale = z.union([z.literal(1), z.literal(1000)])
export type RateScale = z.infer<typeof RateScale>

/** Real terms use 2026-27 prices (see the periods metadata); GDP deflator is the default. */
export const Basis = z.enum(['real-gdp', 'real-cpi', 'nominal'])
export type Basis = z.infer<typeof Basis>
export const DEFAULT_BASIS: Basis = 'real-gdp'

export const ProvenanceKind = z.enum(['measured', 'modelled', 'apportioned', 'survey'])
export type ProvenanceKind = z.infer<typeof ProvenanceKind>

/** Per-value flag bits carried beside every value in series bundles and dossiers. */
export const ValueFlag = {
  apportioned: 1 << 0,
  modelled: 1 << 1,
  survey: 1 << 2,
  suppressed: 1 << 3,
  partialCoverage: 1 << 4,
  harmonised: 1 << 5,
  smallPopulation: 1 << 6,
  seriesBreak: 1 << 7,
} as const
/** Flags that keep a value out of the GB ranks the dossiers publish (compile/values.py). */
export const UNRANKED = ValueFlag.smallPopulation | ValueFlag.partialCoverage | ValueFlag.suppressed

export const ValueFlags = z.int().check(z.minimum(0), z.maximum(255))
export type ValueFlags = z.infer<typeof ValueFlags>

/** Every provenance kind a value carries; a value with no derivation flag is measured. */
export function provenanceKinds(flags: number): readonly ProvenanceKind[] {
  const kinds: ProvenanceKind[] = []
  if (flags & ValueFlag.apportioned) kinds.push('apportioned')
  if (flags & ValueFlag.modelled) kinds.push('modelled')
  if (flags & ValueFlag.survey) kinds.push('survey')
  return kinds.length === 0 ? ['measured'] : kinds
}

/** Multipliers from nominal pounds to real pounds, per fiscal year. */
export interface PriceFactors {
  readonly realGdp: number
  readonly realCpi: number
}

/**
 * Convert a nominal value to the requested basis. Only `gbp` values have a
 * basis; counts and ratios pass through. A missing factor is a defect: the
 * contract parser rejects period metadata that lacks one.
 */
export function applyBasis(
  value: number,
  unit: Unit,
  basis: Basis,
  fiscalYear: FiscalYear,
  factors: ReadonlyMap<FiscalYear, PriceFactors>,
): number {
  if (unit !== 'gbp' || basis === 'nominal') return value
  const factor = factors.get(fiscalYear)
  if (factor === undefined) throw new Error(`No price factors for ${fiscalYear}`)
  return value * (basis === 'real-gdp' ? factor.realGdp : factor.realCpi)
}

const BAND_LABEL = {
  'per-resident': 'resident',
  'per-aged-0-15': 'person aged 0 to 15',
  'per-aged-16-64': 'person aged 16 to 64',
  'per-aged-66-plus': 'person aged 66 and over',
} as const satisfies Record<Exclude<Denominator, 'total'>, string>

const BAND_LABEL_PLURAL = {
  'per-resident': 'residents',
  'per-aged-0-15': 'people aged 0 to 15',
  'per-aged-16-64': 'people aged 16 to 64',
  'per-aged-66-plus': 'people aged 66 and over',
} as const satisfies Record<Exclude<Denominator, 'total'>, string>

/** The plain-English denominator label every chart and sentence must show. */
export function denominatorLabel(denominator: Denominator, rateScale: RateScale): string {
  if (denominator === 'total') return 'total'
  return rateScale === 1000
    ? `per 1,000 ${BAND_LABEL_PLURAL[denominator]}`
    : `per ${BAND_LABEL[denominator]}`
}

/**
 * What a metric's values are counted per: its denominator label, or for the
 * one ratio, benefit spending for each £1 of income tax (rule 4).
 */
export function perLabel(
  metric: { readonly unit: Unit; readonly rateScale: RateScale },
  denominator: Denominator,
): string {
  return metric.unit === 'ratio'
    ? 'for each £1 of income tax'
    : denominatorLabel(denominator, metric.rateScale)
}
