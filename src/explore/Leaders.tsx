/**
 * Top 10 and bottom 10 for the listed denominator. Each row is a link that
 * selects its area, and carries a view-transition name so a re-sort moves
 * rows rather than repainting them.
 */
import type { CSSProperties } from 'react'
import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import type { ExploreState } from '#/domain/url-state.ts'
import { perLabel } from '#/domain/measure.ts'
import { LEVEL_LABEL } from '#/content/labels.ts'
import { formatValue } from '#/lib/format.ts'
import type { ExploreArea } from './load.ts'
import { useExploreLinks } from './follow.ts'
import { queryFor, withSelection, type ColumnView } from './model.ts'

const rowStyle = (code: string): CSSProperties => ({ viewTransitionName: `leader-${code}` })

function LeaderList({
  title,
  areas,
  rows,
  column,
  metric,
  state,
  catalogue,
  max,
}: {
  readonly title: string
  readonly areas: readonly ExploreArea[]
  readonly rows: readonly number[]
  readonly column: ColumnView
  readonly metric: MetricDefinition
  readonly state: ExploreState
  readonly catalogue: Catalogue
  readonly max: number
}) {
  const format = { unit: metric.unit, denominator: column.denominator, rateScale: metric.rateScale }
  const links = useExploreLinks(false)
  return (
    <section aria-label={title}>
      <h3 className="kicker">{title}</h3>
      <ol className="leaders mt-2">
        {rows.map((area) => {
          const meta = areas[area]
          if (meta === undefined) return null
          const value = column.values[area] ?? Number.NaN
          const rank = column.ranking.ranks[area] ?? 0
          const width =
            max > 0 && Number.isFinite(value) ? Math.max(Math.abs(value) / max, 0.02) : 0
          return (
            <li
              key={meta.code}
              style={rowStyle(meta.code)}
              data-selected={state.selected === meta.code ? 'true' : undefined}
            >
              <a
                href={links.hrefFor(queryFor(withSelection(state, meta.code), catalogue))}
                onClick={links.follow}
                className="leader-row"
              >
                <span className="leader-rank tabular">{rank}</span>
                <span className="leader-name">{meta.name}</span>
                <span className="leader-value tabular">{formatValue(value, format)}</span>
                <span className="leader-bar" aria-hidden="true">
                  <span style={{ width: `${(width * 100).toFixed(1)}%` }} />
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function Leaders({
  areas,
  column,
  metric,
  state,
  catalogue,
}: {
  readonly areas: readonly ExploreArea[]
  readonly column: ColumnView
  readonly metric: MetricDefinition
  readonly state: ExploreState
  readonly catalogue: Catalogue
}) {
  const top = column.order.slice(0, 10)
  const bottom = column.order.slice(-10).toReversed()
  let max = 0
  for (const value of column.values)
    if (Number.isFinite(value)) max = Math.max(max, Math.abs(value))
  const label = perLabel(metric, column.denominator)
  const many = LEVEL_LABEL[state.level].many
  return (
    <div className="space-y-6" data-testid="leaders" data-denominator={column.denominator}>
      <p className="text-sm text-ink-muted">
        {column.ranking.rankOf.toLocaleString('en-GB')} {many} ranked, {label}.
      </p>
      <LeaderList
        title="Highest 10"
        rows={top}
        {...{ areas, column, metric, state, catalogue, max }}
      />
      <LeaderList
        title="Lowest 10"
        rows={bottom}
        {...{ areas, column, metric, state, catalogue, max }}
      />
    </div>
  )
}
