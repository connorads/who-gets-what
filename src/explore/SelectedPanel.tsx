/**
 * The selected area's figure, rank and standing for the current framing. The
 * value rolls with NumberFlow when the denominator or period changes; under
 * reduced motion it changes in place.
 */
import NumberFlow from '@number-flow/react'
import { Link } from '@tanstack/react-router'
import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import { perLabel, provenanceKinds, ValueFlag } from '#/domain/measure.ts'
import type { ExploreState } from '#/domain/url-state.ts'
import { LEVEL_LABEL, PROVENANCE_LABEL } from '#/content/labels.ts'
import { comparison, rankText } from '#/content/sentences.ts'
import { formatValue, numberFormatOptions, periodLabel } from '#/lib/format.ts'
import type { ExploreArea } from './load.ts'
import { queryFor, withSelection, type ColumnView } from './model.ts'

/** Plain-language chips for the flags a value carries (ADR 0004 rule 6). */
export function flagChips(flags: number): readonly string[] {
  const chips: string[] = provenanceKinds(flags)
    .filter((kind) => kind !== 'measured')
    .map((kind) => PROVENANCE_LABEL[kind])
  if (flags & ValueFlag.harmonised) chips.push('Includes Scottish benefits')
  if (flags & ValueFlag.partialCoverage) chips.push('Some benefits missing')
  if (flags & ValueFlag.smallPopulation) chips.push('Not ranked: under 1,000 people')
  if (flags & ValueFlag.seriesBreak) chips.push('Boundary or method change')
  return chips
}

export function SelectedPanel({
  area,
  slug,
  index,
  column,
  metric,
  state,
  catalogue,
  reduced,
}: {
  readonly area: ExploreArea | undefined
  /** The area's slug for its page link, from its dossier. */
  readonly slug: string | undefined
  readonly index: number
  readonly column: ColumnView
  readonly metric: MetricDefinition
  readonly state: ExploreState
  readonly catalogue: Catalogue
  readonly reduced: boolean
}) {
  const level = LEVEL_LABEL[state.level]
  if (area === undefined) {
    return (
      <section className="selected-panel" aria-label="Selected area">
        <p className="kicker">Selected area</p>
        <p className="mt-2 text-sm text-ink-muted">
          Choose a {level.one} on the chart, in the lists or the table, or move through them with
          the arrow keys once the chart has focus.
        </p>
      </section>
    )
  }
  const format = { unit: metric.unit, denominator: column.denominator, rateScale: metric.rateScale }
  const value = column.values[index] ?? Number.NaN
  const flags = column.flags[index] ?? 0
  const rank = column.ranking.ranks[index] ?? 0
  const label = perLabel(metric, column.denominator)
  const gb = column.gb?.value
  return (
    <section className="selected-panel" aria-label={`Selected: ${area.name}`}>
      <p className="kicker">Selected {level.one}</p>
      <h2 className="mt-1 font-display text-2xl leading-tight">{area.name}</h2>
      <p className="mt-3 font-mono text-3xl tabular text-ink" data-testid="selected-value">
        {Number.isFinite(value) ? (
          <NumberFlow
            value={value}
            locales="en-GB"
            format={numberFormatOptions(format)}
            animated={!reduced}
            willChange
          />
        ) : (
          'No value'
        )}
      </p>
      <p className="text-sm text-ink-muted">
        {label}, {periodLabel(state.period, metric.periodKind)}
      </p>
      <p className="mt-3 text-sm">
        {rank > 0
          ? `${rankText({ rank, rankOf: column.ranking.rankOf })}: ${comparison({ rank, rankOf: column.ranking.rankOf }, state.level)}.`
          : `Not ranked.`}
        {gb === null || gb === undefined
          ? null
          : ` The Great Britain figure is ${formatValue(gb, format)}.`}
      </p>
      {flagChips(flags).length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="About this value">
          {flagChips(flags).map((chip) => (
            <li key={chip} className="flag-chip">
              {chip}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 flex gap-4 text-sm">
        {slug === undefined ? null : (
          <a href={`/area/${state.level}/${area.code}-${slug}`} className="underline">
            Area page
          </a>
        )}
        <Link
          to="/explore"
          search={queryFor(withSelection(state, undefined), catalogue)}
          resetScroll={false}
          className="text-ink-muted underline"
        >
          Clear selection
        </Link>
      </p>
    </section>
  )
}
