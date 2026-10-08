/**
 * Derived explorer state: typed arrays, ranks, colour bins and mark styles
 * from the loader's data. Pure, so the server render, the SVG fallback and
 * the engine all read one set of numbers.
 */
import type { Catalogue } from '#/domain/contract.ts'
import type { AreaCode, GeoLevel } from '#/domain/geography.ts'
import { ValueFlag, type Denominator } from '#/domain/measure.ts'
import {
  decodeExploreQuery,
  encodeExploreState,
  type ExploreQuery,
  type ExploreState,
} from '#/domain/url-state.ts'
import { binAll, colourDomain, scaleKindOf, type ScaleKind } from '#/viz/colour.ts'
import { STYLE_HALFTONE, STYLE_NO_VALUE } from '#/viz/engine/styles.ts'
import { rankedAreas, rankValues, type Ranking } from '#/domain/rank.ts'
import type { ExploreColumn, ExploreData } from './load.ts'

export interface ColumnView {
  readonly denominator: Denominator
  readonly values: Float32Array
  readonly flags: Uint8Array
  readonly ranking: Ranking
  /** Ranked area indices, highest first. */
  readonly order: readonly number[]
  readonly gb: ExploreColumn['gb']
  readonly scaleKind: ScaleKind
  readonly domain: readonly [number, number]
  readonly bins: Uint8Array
  readonly styles: Uint8Array
}

/** Per-area style bits: halftone for apportioned or modelled values, hatch for no value. */
export function styleBits(values: Float32Array, flags: Uint8Array): Uint8Array {
  return Uint8Array.from(values, (value, i) => {
    const flag = flags[i] ?? 0
    const derived = (flag & (ValueFlag.apportioned | ValueFlag.modelled)) !== 0
    return (derived ? STYLE_HALFTONE : 0) | (Number.isFinite(value) ? 0 : STYLE_NO_VALUE)
  })
}

export function columnView(metricId: string, column: ExploreColumn): ColumnView {
  const values = Float32Array.from(column.values, (value) => value ?? Number.NaN)
  const flags = Uint8Array.from(column.flags)
  const ranking = rankValues(values, flags)
  const scaleKind = scaleKindOf(metricId)
  const domain = colourDomain(values, scaleKind)
  return {
    denominator: column.denominator,
    values,
    flags,
    ranking,
    order: rankedAreas(ranking),
    gb: column.gb,
    scaleKind,
    domain,
    bins: binAll(values, domain, scaleKind),
    styles: styleBits(values, flags),
  }
}

export function columnViews(
  metricId: string,
  columns: ExploreData['columns'],
): readonly ColumnView[] {
  return columns.map((column) => columnView(metricId, column))
}

/** The column for a denominator, falling back to the active one. */
export function columnFor(
  columns: readonly ColumnView[],
  denominator: Denominator,
  active: Denominator,
): ColumnView | undefined {
  return (
    columns.find((column) => column.denominator === denominator) ??
    columns.find((column) => column.denominator === active)
  )
}

/** The same framing at another geography; a selection does not carry across levels. */
export function atLevel(state: ExploreState, level: GeoLevel): ExploreState {
  const { metric, denominator, basis, period, view } = state
  return { level, metric, denominator, basis, period, view }
}

/** The state with `code` selected, or with nothing selected. */
export function withSelection(state: ExploreState, code: AreaCode | undefined): ExploreState {
  const { level, metric, denominator, basis, period, view } = state
  return code === undefined
    ? { level, metric, denominator, basis, period, view }
    : { level, metric, denominator, basis, period, view, selected: code }
}

/** The measure a denominator belongs to: Four rulers stage a change only within one. */
export function measureKey(state: ExploreState): string {
  return `${state.level}|${state.metric}|${state.period}|${state.basis}`
}

/** The canonical search params for a state, typed for the router. */
export function queryFor(state: ExploreState, catalogue: Catalogue): ExploreQuery {
  return decodeExploreQuery(encodeExploreState(state, catalogue)).query
}

/** Swarm positions as a typed array, NaN where an area has no value. */
export function swarmArray(xy: readonly (number | null)[]): Float32Array {
  return Float32Array.from(xy, (value) => value ?? Number.NaN)
}
