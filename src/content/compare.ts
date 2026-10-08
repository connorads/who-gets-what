/**
 * Two areas of one level side by side. Each measure is shown three ways
 * (total, per resident, per person in the group the benefit serves), so a
 * reader can swap the denominator and see which area comes out higher
 * change with it.
 */
import {
  factRows,
  findMetric,
  type AreaDossier,
  type Catalogue,
  type FactRow,
  type GbValues,
  type MetricDefinition,
} from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import {
  denominatorLabel,
  provenanceKinds,
  type Denominator,
  type ProvenanceKind,
} from '#/domain/measure.ts'
import { periodLabel } from '#/lib/format.ts'
import { factorsOf, figure, inBases, type Figure, type PerBasis } from './figures.ts'
import { areaPath, LEVEL_LABEL, NATION_LABEL } from './labels.ts'
import { createSourceNotes, isDerived, type SourceNote } from './sources.ts'

export const MEASURES = [
  { id: 'group', label: 'Per person in the age group' },
  { id: 'resident', label: 'Per resident' },
  { id: 'total', label: 'Total' },
] as const

export type MeasureId = (typeof MEASURES)[number]['id']

export interface CompareSide {
  readonly code: string
  readonly name: string
  readonly href: string
  readonly regionName: string
  readonly nationLabel: string
  readonly population: string
}

export interface CompareValue {
  readonly value: PerBasis<number> | null
  readonly figure: Figure | null
  readonly kinds: readonly ProvenanceKind[]
  readonly derived: boolean
}

export interface CompareCell {
  readonly denominatorText: string
  readonly a: CompareValue
  readonly b: CompareValue
  /** Which area has the higher value; `null` when either is missing or they are equal. */
  readonly higher: 'a' | 'b' | null
}

export interface CompareRow {
  readonly metric: string
  readonly title: string
  readonly kind: 'spend' | 'claimants'
  readonly periodText: string
  readonly cells: Readonly<Record<MeasureId, CompareCell>>
  /** True when the higher area is not the same under every measure. */
  readonly flips: boolean
}

export interface CompareView {
  readonly level: GeoLevel
  readonly levelLabel: (typeof LEVEL_LABEL)[GeoLevel]
  readonly a: CompareSide
  readonly b: CompareSide
  readonly path: string
  readonly swapHref: string
  readonly priceBase: string
  readonly release: string
  readonly rows: readonly CompareRow[]
  /** Per measure, how many rows each area is higher on. */
  readonly tally: Readonly<
    Record<MeasureId, { readonly a: number; readonly b: number; readonly of: number }>
  >
  readonly flips: number
  readonly summary: string
  readonly sources: readonly SourceNote[]
}

const denominatorFor = (metric: MetricDefinition, measure: MeasureId): Denominator =>
  measure === 'total'
    ? 'total'
    : measure === 'resident'
      ? 'per-resident'
      : metric.defaultDenominator

const side = (dossier: AreaDossier): CompareSide => ({
  code: dossier.area.code,
  name: dossier.area.name,
  href: areaPath(dossier.level, dossier.area),
  regionName: dossier.area.region.name,
  nationLabel: NATION_LABEL[dossier.area.nation],
  population: dossier.population.total.toLocaleString('en-GB'),
})

/** "Aldershot is higher than Chelmsford on 5 of 16 measures per person in the age group, ..." */
export function tallySentence(name: string, tally: CompareView['tally'], other: string): string {
  const part = (measure: MeasureId, text: string) =>
    `${tally[measure].a} of ${tally[measure].of} ${text}`
  return `${name} is higher than ${other} on ${part('group', 'measures per person in the age group')}, ${part('resident', 'per resident')} and ${part('total', 'in total')}.`
}

const findFact = (facts: readonly FactRow[], metric: string, denominator: Denominator) =>
  facts.find((row) => row.metric === metric && row.denominator === denominator)

export function buildCompareView(input: {
  readonly catalogue: Catalogue
  readonly gb: GbValues
  readonly a: AreaDossier
  readonly b: AreaDossier
}): CompareView {
  const { catalogue, gb, a, b } = input
  const factors = factorsOf(catalogue)
  const notes = createSourceNotes(catalogue)
  const rowsA = factRows(a.facts, gb)
  const rowsB = factRows(b.facts, gb)

  const metrics = a.facts
    .map((facts) => findMetric(catalogue, facts.metric))
    .filter((metric): metric is MetricDefinition => metric !== undefined)
    .filter(
      (metric) =>
        (metric.id.startsWith('spend-') &&
          !metric.id.includes('-vs-') &&
          metric.id !== 'spend-to-income-tax') ||
        metric.id.startsWith('claimants-'),
    )

  const rows = metrics.map((metric): CompareRow => {
    notes.cite(metric.sources)
    const cell = (measure: MeasureId): CompareCell => {
      const denominator = denominatorFor(metric, measure)
      const one = (facts: readonly FactRow[]): CompareValue => {
        const row = findFact(facts, metric.id, denominator)
        if (row?.value == null) return { value: null, figure: null, kinds: [], derived: false }
        return {
          value: inBases(row.value, metric, row.period, factors),
          figure: figure(row.value, metric, denominator, row.period, factors),
          kinds: provenanceKinds(row.flags),
          derived: isDerived(row.flags),
        }
      }
      const left = one(rowsA)
      const right = one(rowsB)
      const x = left.value?.['real-gdp']
      const y = right.value?.['real-gdp']
      return {
        denominatorText: denominatorLabel(denominator, metric.rateScale),
        a: left,
        b: right,
        higher: x === undefined || y === undefined || x === y ? null : x > y ? 'a' : 'b',
      }
    }
    const cells = { group: cell('group'), resident: cell('resident'), total: cell('total') }
    const leaders = new Set(MEASURES.map((measure) => cells[measure.id].higher).filter(Boolean))
    return {
      metric: metric.id,
      title: metric.shortLabel,
      kind: metric.unit === 'gbp' ? 'spend' : 'claimants',
      periodText: periodLabel(metric.periods.at(-1) ?? '', metric.periodKind),
      cells,
      flips: leaders.size > 1,
    }
  })

  const count = (measure: MeasureId) => {
    const cells = rows.map((row) => row.cells[measure])
    return {
      a: cells.filter((cell) => cell.higher === 'a').length,
      b: cells.filter((cell) => cell.higher === 'b').length,
      of: cells.filter((cell) => cell.higher !== null).length,
    }
  }
  const tally = { group: count('group'), resident: count('resident'), total: count('total') }
  const left = side(a)
  const right = side(b)
  return {
    level: a.level,
    levelLabel: LEVEL_LABEL[a.level],
    a: left,
    b: right,
    path: `${left.href}/vs/${right.code}-${b.area.slug}`,
    swapHref: `${right.href}/vs/${left.code}-${a.area.slug}`,
    priceBase: catalogue.priceBase,
    release: catalogue.release,
    rows,
    tally,
    flips: rows.filter((row) => row.flips).length,
    summary: tallySentence(left.name, tally, right.name),
    sources: notes.list(),
  }
}
