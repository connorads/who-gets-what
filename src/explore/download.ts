/**
 * "Download this view": the explorer's measure, denominator, period and
 * level for every area, as CSV, from the numbers the page already holds.
 */
import { csvFileName, figuresCsv, type FigureRow } from '#/content/csv.ts'
import type { Ranking } from '#/domain/rank.ts'
import type { ExploreData } from './load.ts'

/** One row per area, in area order; values and the GB value are in the reader's basis. */
export function viewRows(data: ExploreData, ranking: Ranking): readonly FigureRow[] {
  const { state, metric, areas } = data
  const column = data.columns.find((entry) => entry.denominator === state.denominator)
  return areas.map((area, i) => ({
    level: state.level,
    code: area.code,
    name: area.name,
    metric,
    denominator: state.denominator,
    period: state.period,
    value: column?.values[i] ?? null,
    rank: ranking.ranks[i] ?? null,
    rankOf: ranking.rankOf,
    gbValue: column?.gb?.value ?? null,
    flags: column?.flags[i] ?? 0,
  }))
}

export function viewCsv(data: ExploreData, ranking: Ranking): string {
  return figuresCsv(viewRows(data, ranking), {
    release: data.catalogue.release,
    basis: data.state.basis,
    catalogue: data.catalogue,
  })
}

export function viewFileName({ state }: Pick<ExploreData, 'state'>): string {
  return csvFileName([state.level, state.metric, state.denominator, state.period, state.basis])
}
