/**
 * Every area with its value under each denominator: the table behind every
 * view (accessibility budget: every chart has an HTML table with the same
 * numbers). The server renders the first rows by rank, which keeps the page
 * small; in the browser a button shows every row and header buttons re-sort
 * them. Without JavaScript, the league table page lists every area.
 */
import { useState, memo } from 'react'
import { rankPath } from '#/content/labels.ts'
import { useHydrated } from '#/lib/hydrated.ts'
import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import type { Denominator } from '#/domain/measure.ts'
import type { ExploreState } from '#/domain/url-state.ts'
import { LEVEL_LABEL } from '#/content/labels.ts'
import { formatValue, periodLabel } from '#/lib/format.ts'
import { denominatorControlLabel } from './Controls.tsx'
import type { ExploreArea } from './load.ts'
import { queryFor, withSelection, type ColumnView } from './model.ts'
import { useExploreLinks, type ExploreLinks } from './follow.ts'
import { flagChips } from './SelectedPanel.tsx'

type SortKey = { readonly by: 'name' } | { readonly by: 'value'; readonly denominator: Denominator }

/** Rows the server renders; the rest render in the browser on request. */
export const FIRST_ROWS = 50

export function sortAreas(
  areas: readonly ExploreArea[],
  columns: readonly ColumnView[],
  key: SortKey,
  descending: boolean,
): readonly number[] {
  const indices = areas.map((_, i) => i)
  if (key.by === 'name') {
    indices.sort((a, b) => (areas[a]?.name ?? '').localeCompare(areas[b]?.name ?? '', 'en-GB'))
    return descending ? indices.toReversed() : indices
  }
  const column = columns.find((c) => c.denominator === key.denominator)
  const value = (i: number) => column?.values[i] ?? Number.NaN
  return indices.toSorted((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (Number.isNaN(va) || Number.isNaN(vb))
      return Number.isNaN(va) ? (Number.isNaN(vb) ? 0 : 1) : -1
    return descending ? vb - va : va - vb
  })
}

function AreaTableImpl({
  areas,
  columns,
  active,
  metric,
  state,
  catalogue,
}: {
  readonly areas: readonly ExploreArea[]
  readonly columns: readonly ColumnView[]
  readonly active: ColumnView
  readonly metric: MetricDefinition
  readonly state: ExploreState
  readonly catalogue: Catalogue
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: { by: 'value', denominator: active.denominator },
    descending: true,
  })
  const chosen = sort.key
  // A sort by a denominator the new measure lacks falls back to the active one.
  const key: SortKey =
    chosen.by === 'value' && !columns.some((c) => c.denominator === chosen.denominator)
      ? { by: 'value', denominator: active.denominator }
      : chosen
  const rows = sortAreas(areas, columns, key, sort.descending)
  const level = LEVEL_LABEL[state.level]
  const ariaSort = (candidate: SortKey): 'ascending' | 'descending' | 'none' => {
    const same =
      candidate.by === key.by &&
      (candidate.by === 'name' || (key.by === 'value' && candidate.denominator === key.denominator))
    if (!same) return 'none'
    return sort.descending ? 'descending' : 'ascending'
  }
  const links = useExploreLinks(false)
  const hydrated = useHydrated()
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? rows : rows.slice(0, FIRST_ROWS)
  const toggle = (candidate: SortKey) =>
    setSort((current) => ({
      key: candidate,
      descending: ariaSort(candidate) === 'none' ? candidate.by !== 'name' : !current.descending,
    }))

  return (
    <section aria-labelledby="table-title" className="mt-16">
      <h2 id="table-title" className="font-display text-title">
        Every {level.one}
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        {metric.label}, {periodLabel(state.period, metric.periodKind)}. Rank is for{' '}
        {denominatorControlLabel(active.denominator, metric).toLowerCase()}, and 1 is the highest.
        Areas with fewer than 1,000 people in the age group have no rank.
        {shown.length < rows.length
          ? ` The first ${shown.length} of ${rows.length.toLocaleString('en-GB')} rows are shown.`
          : ''}
      </p>
      <div className="table-scroll mt-4">
        <table className="area-table">
          <caption className="sr-only">
            {metric.label} for every {level.one}, {periodLabel(state.period, metric.periodKind)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-16">
                Rank
              </th>
              <th scope="col" aria-sort={ariaSort({ by: 'name' })}>
                <button type="button" onClick={() => toggle({ by: 'name' })}>
                  {level.one.charAt(0).toUpperCase() + level.one.slice(1)}
                </button>
              </th>
              {columns.map((column) => {
                const candidate = { by: 'value', denominator: column.denominator } as const
                return (
                  <th
                    key={column.denominator}
                    scope="col"
                    className="num"
                    aria-sort={ariaSort(candidate)}
                  >
                    <button type="button" onClick={() => toggle(candidate)}>
                      {denominatorControlLabel(column.denominator, metric)}
                    </button>
                  </th>
                )
              })}
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const area = areas[i]
              return area === undefined ? null : (
                <AreaRow
                  key={area.code}
                  index={i}
                  area={area}
                  active={active}
                  columns={columns}
                  metric={metric}
                  state={state}
                  catalogue={catalogue}
                  links={links}
                />
              )
            })}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {hydrated ? (
            <button type="button" className="stage-button" onClick={() => setShowAll(true)}>
              Show all {rows.length.toLocaleString('en-GB')} {level.many}
            </button>
          ) : null}
          <a
            href={rankPath(metric.id, active.denominator, state.level)}
            className="text-ink-muted underline"
          >
            League table of every {level.one} for the latest period
          </a>
        </p>
      ) : null}
    </section>
  )
}

/** Memoised: loader data keeps its identity across view and selection changes. */
export const AreaTable = memo(AreaTableImpl)

/** One row: its own component, so a deferred re-render of the table runs in slices. */
const AreaRow = memo(function AreaRow({
  index,
  area,
  active,
  columns,
  metric,
  state,
  catalogue,
  links,
}: {
  readonly index: number
  readonly area: ExploreArea
  readonly active: ColumnView
  readonly columns: readonly ColumnView[]
  readonly metric: MetricDefinition
  readonly state: ExploreState
  readonly catalogue: Catalogue
  readonly links: ExploreLinks
}) {
  const rank = active.ranking.ranks[index] ?? 0
  const chips = flagChips(active.flags[index] ?? 0)
  const href = links.hrefFor(queryFor(withSelection(state, area.code), catalogue))
  return (
    <tr data-selected={state.selected === area.code ? 'true' : undefined}>
      <td className="tabular text-ink-muted">{rank > 0 ? rank : ''}</td>
      <th scope="row">
        <a href={href} onClick={links.follow}>
          {area.name}
        </a>
      </th>
      {columns.map((column) => (
        <td key={column.denominator} className="num tabular">
          {formatValue(column.values[index], {
            unit: metric.unit,
            denominator: column.denominator,
            rateScale: metric.rateScale,
          })}
        </td>
      ))}
      <td className="text-xs text-ink-muted">{chips.join(', ')}</td>
    </tr>
  )
})
