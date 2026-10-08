/**
 * CSV for "Download this view" on the explorer and the area pages, built in
 * the browser from data the page has already read. One row per figure, with
 * its unit, price basis, rank, flags and sources beside the value, so a row
 * read on its own still says what it counts (ADR 0004).
 */
import type { Catalogue, MetricDefinition, ReleaseId } from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import {
  denominatorLabel,
  provenanceKinds,
  ValueFlag,
  type Basis,
  type Denominator,
} from '#/domain/measure.ts'
import { hasBasis } from './figures.ts'

export type CsvCell = string | number | null

/** The price basis in a CSV row names its index, for readers who reuse the file. */
function priceBasis(basis: Basis, priceBase: string): string {
  if (basis === 'nominal') return 'cash terms, not adjusted for prices'
  return `${priceBase} prices, ${basis === 'real-gdp' ? 'GDP deflator' : 'CPI'}`
}

/** One field, quoted when it holds a comma, a quote, a line break or edge spaces (RFC 4180). */
export function csvField(cell: CsvCell): string {
  if (cell === null) return ''
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : ''
  return /[",\r\n]|^\s|\s$/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell
}

/** A header and rows as RFC 4180 CSV: CRLF line ends, ending with one. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows].map((row) => `${row.map(csvField).join(',')}\r\n`).join('')
}

/** Names of the flags set in a value's flag byte, in bit order, joined by `;`. */
export function flagNames(flags: number): string {
  return Object.entries(ValueFlag)
    .filter(([, bit]) => (flags & bit) !== 0)
    .map(([name]) => name)
    .join(';')
}

const UNIT_WORD = { gbp: 'pounds', people: 'people', ratio: 'ratio' } as const

/** What a value counts: "pounds per resident", "people per 1,000 residents", "pounds". */
export function unitText(
  metric: Pick<MetricDefinition, 'unit' | 'rateScale'>,
  denominator: Denominator,
): string {
  const word = UNIT_WORD[metric.unit]
  return denominator === 'total'
    ? word
    : `${word} ${denominatorLabel(denominator, metric.rateScale)}`
}

/** One figure for one area, with the value and the GB value already in `basis`. */
export interface FigureRow {
  readonly level: GeoLevel
  readonly code: string
  readonly name: string
  readonly metric: MetricDefinition
  readonly denominator: Denominator
  readonly period: string
  readonly value: number | null
  readonly rank: number | null
  readonly rankOf: number | null
  readonly gbValue: number | null
  readonly flags: number
}

export interface FigureContext {
  readonly release: ReleaseId
  readonly basis: Basis
  readonly catalogue: Pick<Catalogue, 'priceBase' | 'sources'>
}

export const FIGURE_COLUMNS = [
  'area_code',
  'area_name',
  'level',
  'measure_id',
  'measure',
  'period',
  'denominator',
  'unit',
  'price_basis',
  'value',
  'rank',
  'ranked_of',
  'gb_value',
  'provenance',
  'flags',
  'sources',
  'release',
] as const

/** Figures as CSV in `FIGURE_COLUMNS` order; an area with no value keeps its row with an empty value. */
export function figuresCsv(rows: readonly FigureRow[], context: FigureContext): string {
  const titles = new Map(context.catalogue.sources.map((source) => [source.id, source.title]))
  return toCsv(
    FIGURE_COLUMNS,
    rows.map((row) => [
      row.code,
      row.name,
      row.level,
      row.metric.id,
      row.metric.label,
      row.period,
      row.denominator,
      unitText(row.metric, row.denominator),
      hasBasis(row.metric) ? priceBasis(context.basis, context.catalogue.priceBase) : '',
      row.value,
      row.rank !== null && row.rank > 0 ? row.rank : null,
      row.rankOf,
      row.gbValue,
      provenanceKinds(row.flags).join(';'),
      flagNames(row.flags),
      row.metric.sources.map((id) => titles.get(id) ?? id).join('; '),
      context.release,
    ]),
  )
}

/** `who-gets-what-` and the parts, as a safe file name. */
export function csvFileName(parts: readonly string[]): string {
  const stem = ['who-gets-what', ...parts]
    .join('-')
    .toLowerCase()
    .replaceAll(/[^a-z0-9.-]+/g, '-')
  return `${stem}.csv`
}
