/**
 * The explorer page: headline, controls, stage, lists, heroes and the full
 * table, all from one URL state. Changing any control navigates; the loader
 * reads the new state and every surface updates from the same numbers.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { perLabel } from '#/domain/measure.ts'
import { viewsFor, type ExploreState } from '#/domain/url-state.ts'
import { useReducedMotion } from '#/lib/preferences-dom.ts'
import { basisExplained, LEVEL_LABEL } from '#/content/labels.ts'
import { periodLabel } from '#/lib/format.ts'
import { leaderSentence } from '#/content/sentences.ts'
import { AreaTable } from './AreaTable.tsx'
import { Controls, VIEW_LABEL } from './Controls.tsx'
import { DownloadView } from './DownloadView.tsx'
import { FlipHeadline } from './FlipHeadline.tsx'
import { ExpectedScatter } from './heroes/ExpectedScatter.tsx'
import { RankRulers } from './heroes/RankRulers.tsx'
import { Waterfall } from './heroes/Waterfall.tsx'
import { Leaders } from './Leaders.tsx'
import type { ExploreData } from './load.ts'
import { MetricIndex, MetricPicker } from './MetricPicker.tsx'
import { columnFor, columnViews, withSelection } from './model.ts'
import { SelectedPanel } from './SelectedPanel.tsx'
import { Stage } from './Stage.tsx'
import { useStagedDenominators } from './staging.ts'

export interface ExplorerProps {
  readonly data: ExploreData
  readonly go: (next: ExploreState, options?: { readonly replace?: boolean }) => void
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function Explorer({ data, go }: ExplorerProps) {
  const { state, catalogue, metric, areas } = data
  const reduced = useReducedMotion()
  const [pickerOpen, setPickerOpen] = useState(false)
  const columns = useMemo(() => columnViews(metric.id, data.columns), [metric.id, data.columns])
  const staged = useStagedDenominators(state, reduced)
  const active = columnFor(columns, state.denominator, state.denominator)
  const listed = columnFor(columns, staged.list, state.denominator) ?? active
  const indexByCode = useMemo(() => new Map(areas.map((area, i) => [area.code, i])), [areas])
  const selected = state.selected === undefined ? -1 : (indexByCode.get(state.selected) ?? -1)
  const level = LEVEL_LABEL[state.level]
  // The table and the measure index re-render behind the canvas, in idle time.
  const later = useDeferredValue(state)
  const laterActive = useDeferredValue(active)
  const laterColumns = useDeferredValue(columns)

  // Selection reads the latest state through a ref, so the handler keeps one identity
  // and memoised children (the area navigator) skip unrelated re-renders.
  const current = useRef(state)
  useEffect(() => {
    current.current = state
  })
  const select = useCallback(
    (area: number) => {
      const now = current.current
      const code = areas[area]?.code
      go(withSelection(now, code === now.selected ? undefined : code))
    },
    [areas, go],
  )

  // View keys (M, E, S, R) and the measure palette (Command or Control and K).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPickerOpen((open) => !open)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || pickerOpen)
        return
      const view = viewsFor(state.level).find((v) => VIEW_LABEL[v].key === event.key.toUpperCase())
      if (view !== undefined && view !== state.view) go({ ...state, view })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, state, pickerOpen])

  if (active === undefined || listed === undefined) return null
  const leader = listed.order[0]
  const headline =
    leader === undefined
      ? `${metric.label}: no ${level.one} has a ranked value for ${periodLabel(state.period, metric.periodKind)}.`
      : leaderSentence({
          metric,
          denominator: listed.denominator,
          area: areas[leader]?.name ?? '',
          period: periodLabel(state.period, metric.periodKind),
        })
  const bump = columnFor(columns, staged.bump, state.denominator) ?? active

  return (
    <div className="explorer pb-10">
      <header className="pt-8 md:pt-12">
        <p className="explore-question">How does my area compare?</p>
        <FlipHeadline sentence={headline} />
        <p className="mt-2 max-w-prose text-ink-muted">
          {metric.description}{' '}
          {metric.unit === 'gbp'
            ? `Shown in ${basisExplained(state.basis, catalogue.priceBase)}.`
            : ''}
        </p>
      </header>

      <div className="mt-6">
        <Controls
          state={state}
          catalogue={catalogue}
          metric={metric}
          periods={data.periods}
          onOpenPicker={() => setPickerOpen(true)}
          onPeriod={(period, commit) => go({ ...state, period }, { replace: !commit })}
        />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Stage
          data={data}
          column={active}
          selected={selected}
          onSelect={select}
          onView={(view) => go({ ...state, view })}
        />
        <aside className="space-y-8" aria-label="Rankings and selection">
          <SelectedPanel
            area={areas[selected]}
            slug={data.selectedSlug}
            index={selected}
            column={active}
            metric={metric}
            state={state}
            catalogue={catalogue}
            reduced={reduced}
          />
          <Leaders
            areas={areas}
            column={listed}
            metric={metric}
            state={state}
            catalogue={catalogue}
          />
        </aside>
      </div>

      <details className="more-charts mt-12">
        <summary>
          <span className="more-charts__title">More ways to look at it</span>
          <span className="more-charts__note">
            How ranks change, why spending changed, and spending compared with the expected level
          </span>
        </summary>
        <div className="viz-hero-grid mt-8">
          <RankRulers
            areas={areas}
            columns={columns}
            listed={bump.denominator}
            selected={selected}
            metric={metric}
            level={state.level}
            reduced={reduced}
          />
          <Waterfall
            catalogue={catalogue}
            metric={metric}
            level={state.level}
            basis={state.basis}
            areaName={areas[selected]?.name}
            inputs={data.selectedDecomposition}
            reduced={reduced}
          />
          {data.expectedFit === undefined ? null : (
            <ExpectedScatter
              fit={data.expectedFit}
              catalogue={catalogue}
              level={state.level}
              metric={metric}
              basis={state.basis}
              areaOrderHash={data.areaOrderHash}
              areas={areas}
              selected={selected}
              reduced={reduced}
            />
          )}
        </div>
      </details>

      {laterActive === undefined ? null : (
        <AreaTable
          areas={areas}
          columns={laterColumns}
          active={laterActive}
          metric={metric}
          state={later}
          catalogue={catalogue}
        />
      )}
      {active === undefined ? null : <DownloadView data={data} active={active} />}
      <p className="mt-3 text-xs text-ink-muted">
        Values are {perLabel(metric, active.denominator)} unless a column says otherwise. Sources:{' '}
        {metric.sources
          .map((id) => catalogue.sources.find((source) => source.id === id)?.publisher ?? id)
          .filter((publisher, i, all) => all.indexOf(publisher) === i)
          .join(', ')}
        .
      </p>

      <details className="more-charts mt-12">
        <summary>
          <span className="more-charts__title">Every measure</span>
          <span className="more-charts__note">The full list, as plain links</span>
        </summary>
        <MetricIndex catalogue={catalogue} state={later} />
      </details>
      <MetricPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        catalogue={catalogue}
        state={state}
        onChoose={(next) => go(next)}
      />
    </div>
  )
}
