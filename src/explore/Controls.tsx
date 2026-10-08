/**
 * Explorer controls. Every choice is a link to its URL state, so each works
 * without JavaScript and opens in a new tab; the period scrubber and the
 * measure palette add keyboard and pointer conveniences on top.
 */
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Slider } from '#/components/ui/slider.tsx'
import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import { GeoLevel } from '#/domain/geography.ts'
import { Basis, perLabel, type Denominator } from '#/domain/measure.ts'
import { viewsFor, type ExploreState, type View } from '#/domain/url-state.ts'
import { BASIS_CHOICE, LEVEL_LABEL } from '#/content/labels.ts'
import { periodLabel, shortPeriodLabel } from '#/lib/format.ts'
import { atLevel, queryFor } from './model.ts'

export const VIEW_LABEL = {
  map: { label: 'Map', key: 'M' },
  hex: { label: 'Equal-size areas', key: 'E' },
  swarm: { label: 'Dots by age', key: 'S' },
  rank: { label: 'Ranked list', key: 'R' },
} as const satisfies Record<View, { label: string; key: string }>

/** The two views most readers want; the other shapes wait under Refine. */
const MAIN_VIEWS: readonly View[] = ['map', 'rank']

function Segmented({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <fieldset className="seg-group">
      <legend className="kicker seg-label">{label}</legend>
      <div className="seg">{children}</div>
    </fieldset>
  )
}

function StateLink({
  state,
  catalogue,
  children,
  title,
}: {
  readonly state: ExploreState
  readonly catalogue: Catalogue
  readonly children: ReactNode
  readonly title?: string
}) {
  return (
    <Link
      to="/explore"
      search={queryFor(state, catalogue)}
      resetScroll={false}
      className="seg-item"
      activeOptions={{ exact: true, includeSearch: true }}
      title={title}
    >
      {children}
    </Link>
  )
}

/** Sentence-case label for a denominator control. */
export function denominatorControlLabel(
  denominator: Denominator,
  metric: MetricDefinition,
): string {
  const label = perLabel(metric, denominator)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export interface ControlsProps {
  readonly state: ExploreState
  readonly catalogue: Catalogue
  readonly metric: MetricDefinition
  readonly periods: readonly string[]
  readonly onOpenPicker: () => void
  readonly onPeriod: (period: string, commit: boolean) => void
}

export function Controls({
  state,
  catalogue,
  metric,
  periods,
  onOpenPicker,
  onPeriod,
}: ControlsProps) {
  const periodIndex = Math.max(periods.indexOf(state.period), 0)
  // The thumb follows a drag at once; a new URL period resets it.
  const [drag, setDrag] = useState({ index: periodIndex, from: periodIndex })
  const scrub = drag.from === periodIndex ? drag.index : periodIndex
  const setScrub = (index: number) => setDrag({ index, from: periodIndex })

  const period = periodLabel(state.period, metric.periodKind)
  const denominatorText = perLabel(metric, state.denominator)

  return (
    <nav aria-label="Explorer settings" className="explore-controls">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="#measures"
          className="measure-trigger"
          onClick={(event) => {
            event.preventDefault()
            onOpenPicker()
          }}
          aria-haspopup="dialog"
          aria-label={`Measure: ${metric.shortLabel}. Change measure`}
        >
          <span className="truncate">{metric.shortLabel}</span>
          <span className="measure-kbd" aria-hidden="true">
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor">
              <path d="M4 6l4 4 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </a>
        <fieldset className="seg">
          <legend className="sr-only">Show as</legend>
          {MAIN_VIEWS.map((view) => (
            <StateLink
              key={view}
              catalogue={catalogue}
              state={{ ...state, view }}
              title={`${VIEW_LABEL[view].label} view (key ${VIEW_LABEL[view].key})`}
            >
              {VIEW_LABEL[view].label}
            </StateLink>
          ))}
        </fieldset>
      </div>

      <details className="refine mt-3">
        <summary>
          Refine
          <span className="refine__summary-note">
            {LEVEL_LABEL[state.level].titleMany}, {denominatorText}, {period}
          </span>
        </summary>
        <div className="refine__panel card">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <Segmented label="Area type">
              {GeoLevel.options.map((level) => (
                <StateLink key={level} catalogue={catalogue} state={atLevel(state, level)}>
                  {LEVEL_LABEL[level].titleMany}
                </StateLink>
              ))}
            </Segmented>
            <Segmented label="Count">
              {metric.denominators.map((denominator) => (
                <StateLink
                  key={denominator}
                  catalogue={catalogue}
                  state={{ ...state, denominator }}
                >
                  {denominatorControlLabel(denominator, metric)}
                </StateLink>
              ))}
            </Segmented>
            {metric.unit === 'gbp' ? (
              <Segmented label="Prices">
                {Basis.options.map((basis) => (
                  <StateLink key={basis} catalogue={catalogue} state={{ ...state, basis }}>
                    {BASIS_CHOICE[basis]}
                  </StateLink>
                ))}
              </Segmented>
            ) : null}
            <Segmented label="Chart">
              {viewsFor(state.level).map((view) => (
                <StateLink
                  key={view}
                  catalogue={catalogue}
                  state={{ ...state, view }}
                  title={`${VIEW_LABEL[view].label} view (key ${VIEW_LABEL[view].key})`}
                >
                  {VIEW_LABEL[view].label}
                </StateLink>
              ))}
            </Segmented>
          </div>
          {periods.length > 1 ? (
            <div className="period-scrubber">
              <span className="kicker seg-label" id="period-label">
                Year
              </span>
              <div className="mt-2 flex items-center gap-4">
                <span className="w-24 shrink-0 font-semibold tabular" aria-live="polite">
                  {periodLabel(periods[scrub] ?? state.period, metric.periodKind)}
                </span>
                <div className="relative min-w-0 flex-1">
                  <Slider
                    aria-labelledby="period-label"
                    min={0}
                    max={periods.length - 1}
                    step={1}
                    value={[scrub]}
                    onValueChange={([value]) => {
                      if (value === undefined) return
                      setScrub(value)
                      onPeriod(periods[value] ?? state.period, false)
                    }}
                    onValueCommit={([value]) => {
                      if (value !== undefined) onPeriod(periods[value] ?? state.period, true)
                    }}
                  />
                  <ol className="period-ticks" aria-hidden="true">
                    {periods.map((p, i) => (
                      <li
                        key={p}
                        data-current={i === scrub ? 'true' : undefined}
                        data-edge={i === 0 || i === periods.length - 1 ? 'true' : undefined}
                      >
                        {shortPeriodLabel(p, metric.periodKind)}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">This measure has figures for {period} only.</p>
          )}
        </div>
      </details>
    </nav>
  )
}
