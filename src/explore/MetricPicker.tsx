/**
 * The measure palette (Command or Control and K). Measures are grouped by
 * what they count. The same list renders as plain links at the foot of the
 * page, which is where the trigger points without JavaScript.
 */
import { memo } from 'react'
import { useExploreLinks } from './follow.ts'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command.tsx'
import { Command } from '#/components/ui/command.tsx'
import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import type { ExploreState } from '#/domain/url-state.ts'
import { queryFor } from './model.ts'

export interface MetricGroup {
  readonly title: string
  readonly metrics: readonly MetricDefinition[]
}

/** Measures grouped by what they count, in catalogue order within each group. */
export function metricGroups(catalogue: Catalogue, state: ExploreState): readonly MetricGroup[] {
  const available = catalogue.metrics.filter((metric) => metric.levels.includes(state.level))
  const groups: readonly [string, (metric: MetricDefinition) => boolean][] = [
    [
      'Spending',
      (m) => m.id.startsWith('spend-') && !m.id.endsWith('-vs-model') && m.unit === 'gbp',
    ],
    ['Spending compared with the expected level', (m) => m.id.endsWith('-vs-model')],
    ['People receiving benefits', (m) => m.unit === 'people'],
    ['Income tax', (m) => m.id.includes('income-tax')],
  ]
  return groups
    .map(([title, test]) => ({ title, metrics: available.filter(test) }))
    .filter((group) => group.metrics.length > 0)
}

/** The state after choosing a measure: denominator and period kept where it publishes them. */
export function withMetric(state: ExploreState, metric: MetricDefinition): ExploreState {
  return {
    ...state,
    metric: metric.id,
    denominator: metric.denominators.includes(state.denominator)
      ? state.denominator
      : metric.defaultDenominator,
    period: metric.periods.includes(state.period) ? state.period : (metric.periods.at(-1) ?? ''),
  }
}

export function MetricPicker({
  open,
  onOpenChange,
  catalogue,
  state,
  onChoose,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly catalogue: Catalogue
  readonly state: ExploreState
  readonly onChoose: (next: ExploreState) => void
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a measure"
      description="Search benefit spending, people receiving benefits and income tax"
      className="sm:max-w-lg"
    >
      <Command>
        <CommandInput placeholder="Search measures" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>No measure matches.</CommandEmpty>
          {metricGroups(catalogue, state).map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.metrics.map((metric) => (
                <CommandItem
                  key={metric.id}
                  value={`${metric.label} ${metric.shortLabel}`}
                  data-checked={metric.id === state.metric ? 'true' : undefined}
                  onSelect={() => {
                    onOpenChange(false)
                    onChoose(withMetric(state, metric))
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{metric.shortLabel}</span>
                    <span className="truncate text-xs text-ink-muted">{metric.label}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

/** Every measure as a link: the palette's no-JavaScript twin. */
function MetricIndexImpl({
  catalogue,
  state,
}: {
  readonly catalogue: Catalogue
  readonly state: ExploreState
}) {
  const links = useExploreLinks(true)
  return (
    <nav id="measures" aria-labelledby="measures-title" className="rule-t mt-16 pt-6">
      <h2 id="measures-title" className="kicker">
        Every measure
      </h2>
      <div className="mt-4 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        {metricGroups(catalogue, state).map((group) => (
          <section key={group.title}>
            <h3 className="font-display text-xl">{group.title}</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {group.metrics.map((metric) => (
                <li key={metric.id}>
                  <a
                    href={links.hrefFor(queryFor(withMetric(state, metric), catalogue))}
                    onClick={links.follow}
                    aria-current={metric.id === state.metric ? 'true' : undefined}
                    className="text-ink-muted hover:text-ink aria-[current=true]:font-medium aria-[current=true]:text-ink"
                  >
                    {metric.shortLabel}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )
}

/** Memoised: loader data keeps its identity across view and selection changes. */
export const MetricIndex = memo(MetricIndexImpl)
