/**
 * A league table for one metric and denominator at each level, from the
 * series bundle's latest period. Ranks follow the pipeline's rule: highest
 * first, ties share the lower rank, and values that are suppressed, cover
 * only some benefits or have a group under 1,000 people are listed unranked.
 */
import type { SeriesBundle } from '#/domain/bundle.ts'
import { periodSlice } from '#/domain/bundle.ts'
import {
  gbValueOf,
  type AreasMeta,
  type Catalogue,
  type GbValues,
  type MetricDefinition,
} from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import {
  perLabel,
  provenanceKinds,
  type Denominator,
  type ProvenanceKind,
} from '#/domain/measure.ts'
import { rankValues } from '#/domain/rank.ts'
import { encodeExploreState, resolveExploreState } from '#/domain/url-state.ts'
import { periodLabel } from '#/lib/format.ts'
import { factorsOf, figure, inBases, type Figure, type PerBasis } from './figures.ts'
import { areaPath, LEVEL_LABEL, NATION_LABEL, rankPath } from './labels.ts'
import { comparison, inSentence, measurePhrase, unrankedReason } from './sentences.ts'
import { createSourceNotes, isDerived, type SourceNote } from './sources.ts'

export interface RankRow {
  readonly code: string
  readonly name: string
  readonly href: string
  readonly nation: string
  readonly nationLabel: string
  readonly region: string
  readonly regionName: string
  readonly value: PerBasis<number> | null
  readonly figure: Figure | null
  readonly rank: number | null
  readonly unranked: string | null
  readonly flags: number
  readonly kinds: readonly ProvenanceKind[]
  readonly derived: boolean
  /** `highest` for the first ten ranks, `lowest` for the last ten. */
  readonly band: 'highest' | 'lowest' | null
}

export interface RankTable {
  readonly level: GeoLevel
  readonly levelLabel: (typeof LEVEL_LABEL)[GeoLevel]
  readonly period: string
  readonly periodText: string
  readonly rankOf: number
  readonly gb: Figure | null
  readonly rows: readonly RankRow[]
  readonly regions: readonly { readonly code: string; readonly name: string }[]
  readonly derivedCount: number
  readonly exploreHref: string
}

export interface RankView {
  readonly metric: MetricDefinition
  readonly denominator: Denominator
  readonly title: string
  readonly measure: string
  /** What the measure is divided by; empty for a ratio, which is divided by nothing. */
  readonly denominatorText: string
  readonly path: string
  readonly priceBase: string
  readonly release: string
  readonly money: boolean
  readonly tables: readonly RankTable[]
  readonly others: readonly { readonly label: string; readonly href: string }[]
  readonly caveats: readonly string[]
  readonly sources: readonly SourceNote[]
  readonly summary: string
}

export interface RankLevelInput {
  readonly areas: AreasMeta
  readonly gb: GbValues
  readonly bundle: SeriesBundle
}

function rankTable(
  catalogue: Catalogue,
  metric: MetricDefinition,
  denominator: Denominator,
  input: RankLevelInput,
): RankTable {
  const { areas, gb, bundle } = input
  const level = areas.level
  const factors = factorsOf(catalogue)
  const periodIndex = bundle.header.periods.length - 1
  const period = bundle.header.periods[periodIndex] ?? ''
  const { values, flags } = periodSlice(bundle, periodIndex)
  const { ranks, rankOf } = rankValues(values, flags)
  const regions = new Map(areas.regions.map((region) => [region.code, region.name]))
  const rows = areas.areas.map((area, i): RankRow => {
    const raw = values[i] ?? Number.NaN
    const flag = flags[i] ?? 0
    const rank = (ranks[i] ?? 0) > 0 ? (ranks[i] ?? null) : null
    const has = !Number.isNaN(raw)
    return {
      code: area.code,
      name: area.name,
      href: areaPath(level, area),
      nation: area.nation,
      nationLabel: NATION_LABEL[area.nation],
      region: area.region,
      regionName: regions.get(area.region) ?? '',
      value: has ? inBases(raw, metric, period, factors) : null,
      figure: has ? figure(raw, metric, denominator, period, factors) : null,
      rank,
      unranked: rank !== null ? null : has ? unrankedReason(flag) : 'No value published',
      flags: flag,
      kinds: provenanceKinds(flag),
      derived: isDerived(flag),
      band: rank === null ? null : rank <= 10 ? 'highest' : rank > rankOf - 10 ? 'lowest' : null,
    }
  })
  const context = gbValueOf(gb, metric.id, denominator, period)
  const explore = resolveExploreState(
    { level, metric: metric.id, denom: denominator, view: 'rank' },
    catalogue,
  ).state
  return {
    level,
    levelLabel: LEVEL_LABEL[level],
    period,
    periodText: periodLabel(period, metric.periodKind),
    rankOf,
    gb: context?.value == null ? null : figure(context.value, metric, denominator, period, factors),
    rows: rows.toSorted(
      (a, b) =>
        (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name, 'en-GB'),
    ),
    regions: areas.regions.map((region) => ({ code: region.code, name: region.name })),
    derivedCount: rows.filter((row) => row.derived).length,
    exploreHref: `/explore?${new URLSearchParams(encodeExploreState(explore, catalogue)).toString()}`,
  }
}

export function buildRankView(
  catalogue: Catalogue,
  metric: MetricDefinition,
  denominator: Denominator,
  levels: readonly RankLevelInput[],
): RankView {
  const notes = createSourceNotes(catalogue)
  notes.cite(metric.sources)
  const divisor = perLabel(metric, denominator)
  const ratio = metric.unit === 'ratio'
  const measure = ratio ? inSentence(metric.label) : measurePhrase(metric.label, divisor)
  const denominatorText = ratio ? '' : divisor
  const tables = levels.map((input) => rankTable(catalogue, metric, denominator, input))
  const first = tables[0]
  const top = first?.rows[0]
  return {
    metric,
    denominator,
    title: denominatorText === '' ? metric.shortLabel : `${metric.shortLabel}, ${denominatorText}`,
    measure,
    denominatorText,
    path: rankPath(metric.id, denominator),
    priceBase: catalogue.priceBase,
    release: catalogue.release,
    money: metric.unit === 'gbp',
    tables,
    others: metric.denominators
      .filter((other) => other !== denominator)
      .map((other) => ({
        label: perLabel(metric, other),
        href: rankPath(metric.id, other),
      })),
    caveats: metric.caveats.flatMap((id) => {
      const caveat = catalogue.caveats.find((entry) => entry.id === id)
      return caveat === undefined ? [] : [caveat.text]
    }),
    sources: notes.list(),
    summary:
      first === undefined || top?.rank == null
        ? `Every area ranked on ${measure}.`
        : `${top.name} is ${comparison({ rank: 1, rankOf: first.rankOf }, first.level)} on ${measure} in ${first.periodText}. This page lists all ${first.rankOf.toLocaleString('en-GB')} ranked ${first.levelLabel.many} and every local authority, with the figure for Great Britain.`,
  }
}
