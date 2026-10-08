import type { Catalogue, MetricDefinition } from '#/domain/contract.ts'
import { perLabel } from '#/domain/measure.ts'
import { rankPath } from '#/content/labels.ts'

const GROUPS: readonly {
  readonly title: string
  readonly note: string
  readonly match: (metric: MetricDefinition) => boolean
}[] = [
  {
    title: 'Spending by benefit',
    note: 'Spending in each year, from DWP area tables, with the Social Security Scotland benefits that replace some of them.',
    match: (metric) =>
      metric.id.startsWith('spend-') &&
      !metric.id.includes('-vs-') &&
      metric.id !== 'spend-to-income-tax',
  },
  {
    title: 'People receiving benefits',
    note: 'The number of people claiming in the latest month, per 1,000 people in the age group the benefit is for.',
    match: (metric) => metric.id.startsWith('claimants-'),
  },
  {
    title: 'Income tax only',
    note: 'Income tax paid by residents, estimated from a survey, and benefit spending compared with it in the same year.',
    match: (metric) => metric.id === 'income-tax' || metric.id === 'spend-to-income-tax',
  },
  {
    title: 'Compared with the expected level',
    note: 'Actual spending minus the level we would expect from age, deprivation, pay and nation.',
    match: (metric) => metric.id.includes('-vs-model'),
  },
]

export function RankIndexPage({ catalogue }: { catalogue: Catalogue }) {
  return (
    <article>
      <header className="pt-12 pb-4 md:pt-20 md:pb-8">
        <p className="kicker">Rankings</p>
        <h1 className="mt-4 max-w-[18ch] font-display text-headline text-balance">
          Which areas are highest and lowest?
        </h1>
        <div className="mt-6 max-w-prose text-lg text-pretty text-ink-muted">
          <p>
            Each ranking puts every constituency and local authority in order on one measure. The
            order changes depending on what you count. Total spending, spending per resident and
            spending per person in the benefit&apos;s age group all give different orders. So every
            table says what it counts.
          </p>
        </div>
      </header>
      {GROUPS.map((group) => {
        const metrics = catalogue.metrics.filter(group.match)
        if (metrics.length === 0) return null
        return (
          <section key={group.title} className="dossier-section" aria-label={group.title}>
            <h2 className="font-display text-title">{group.title}</h2>
            <p className="mt-2 max-w-prose text-ink-muted">{group.note}</p>
            <ul className="rank-index">
              {metrics.map((metric) => (
                <li key={metric.id} className="rank-index__row">
                  <span className="rank-index__label">{metric.shortLabel}</span>
                  <span className="rank-index__links">
                    {metric.denominators.map((denominator) => (
                      <a key={denominator} href={rankPath(metric.id, denominator)}>
                        {perLabel(metric, denominator)}
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="mt-10 max-w-prose text-sm text-ink-muted">
        Areas with fewer than 1,000 people in the age group have no rank.
      </p>
    </article>
  )
}
