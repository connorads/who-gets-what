/**
 * Methods, built from the release catalogue so every rule, factor and
 * coefficient on the page is the one the figures used.
 */
import type { ReactNode } from 'react'
import { BASES, basisLabel, LEVEL_LABEL, NATION_LABEL } from '#/content/labels.ts'
import { capitalise } from '#/content/sentences.ts'
import { priceFactors, type Catalogue } from '#/domain/contract.ts'
import { GeoLevel } from '#/domain/geography.ts'
import { decompose } from '#/domain/decomposition.ts'
import { denominatorLabel, ValueFlag } from '#/domain/measure.ts'
import { formatMonth, formatPounds } from '#/lib/format.ts'
import { EFFECT_LABEL } from '#/viz/waterfall.ts'
import { Caveat, SourceList } from '../parts.tsx'
import { createSourceNotes } from '#/content/sources.ts'

const FLAG_NOTES: readonly (readonly [keyof typeof ValueFlag, string, string])[] = [
  ['apportioned', 'Shared out', 'Shared out from a larger area by population. Shown with dots.'],
  [
    'modelled',
    'Estimated',
    'Worked out from other figures, for example the number of people claiming times their average payment. Shown with dots.',
  ],
  ['survey', 'Survey estimate', 'From a sample survey, such as HMRC income tax. Shown with dots.'],
  [
    'suppressed',
    'Not published',
    'The source does not publish it. Shown as no value and not ranked.',
  ],
  [
    'partialCoverage',
    'Some benefits missing',
    'Some benefits in the group are missing for this period. Not ranked.',
  ],
  ['harmonised', 'Includes Scotland', 'Includes a Social Security Scotland benefit.'],
  ['smallPopulation', 'Small population', 'Fewer than 1,000 people in the age group. Not ranked.'],
  [
    'seriesBreak',
    'Boundary or method change',
    'Boundaries or methods changed at this point. Marked on trend charts.',
  ],
]

function Block({
  id,
  index,
  title,
  children,
}: {
  id: string
  index: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="methods-block">
      <p className="methods-block__index" aria-hidden="true">
        {index}
      </p>
      <h2 id={`${id}-title`} className="methods-block__title">
        {title}
      </h2>
      <div className="methods-block__body">{children}</div>
    </section>
  )
}

function Formula({ children, label }: { children: ReactNode; label: string }) {
  return (
    <figure className="formula">
      <div className="formula__body">{children}</div>
      <figcaption className="formula__label">{label}</figcaption>
    </figure>
  )
}

const money = (value: number) => formatPounds(value, { total: true, sign: true })

const COUNT_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four' }

const caveat = (catalogue: Catalogue, id: string) =>
  catalogue.caveats.find((entry) => entry.id === id)?.text

export function MethodsPage({ catalogue }: { catalogue: Catalogue }) {
  const notes = createSourceNotes(catalogue)
  notes.cite(catalogue.sources.map((source) => source.id))
  const factors = priceFactors(catalogue)
  const { expected, neighbours, inputs } = catalogue.models
  const inputLabel = (id: string) => inputs.find((input) => input.id === id)?.label ?? id
  const priceBase = catalogue.priceBase
  const metricsByDenominator = catalogue.metrics.filter((metric) => metric.unit !== 'ratio')

  return (
    <article className="methods">
      <header className="pt-12 pb-4 md:pt-20 md:pb-8">
        <p className="kicker">Methods · data release {catalogue.release}</p>
        <h1 className="mt-4 max-w-[18ch] font-display text-headline text-balance">
          How we worked out the figures
        </h1>
        <div className="mt-6 max-w-prose text-lg text-pretty text-ink-muted">
          <p>
            This page sets out the rules behind every figure on the site. We describe the figures.
            We do not judge them.
          </p>
          <p>
            The page is built from the same data release as every chart, so the numbers below are
            the ones the figures used. Automated tests check every rule that a computer can check.
          </p>
        </div>
        <nav aria-label="Methods sections" className="methods-nav">
          {[
            ['denominators', 'Per person figures'],
            ['prices', 'Inflation'],
            ['provenance', 'Estimates'],
            ['scotland', 'Scotland'],
            ['ranks', 'Ranks'],
            ['decomposition', 'What changed'],
            ['expected', 'Expected level'],
            ['neighbours', 'Similar areas'],
            ['copy', 'Words and colours'],
            ['issues', 'Limits of the data'],
            ['sources', 'Sources'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Block id="denominators" index="01" title="Who do we divide by?">
        <p>
          A per person figure divides by the people the benefit is for. Pensioner benefits use
          people aged 66 and over, which is State Pension age. Working-age benefits use people aged
          16 to 64. Benefits paid at any adult age use all residents. Counts of people claiming are
          per 1,000 people in the age group.
        </p>
        <p>
          Area figures do not count people who could claim but do not. So we cannot show spending
          for each person who could claim. You can always see totals and per resident figures, and
          every chart, table and sentence says what it divides by.
        </p>
        <div className="numbers__scroll">
          <table className="ledger-table">
            <caption className="ledger-table__caption">What each measure is divided by</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Shown first</th>
                <th scope="col">Also available</th>
              </tr>
            </thead>
            <tbody>
              {metricsByDenominator.map((metric) => (
                <tr key={metric.id}>
                  <th scope="row">{metric.label}</th>
                  <td>{denominatorLabel(metric.defaultDenominator, metric.rateScale)}</td>
                  <td>
                    {metric.denominators
                      .filter((denominator) => denominator !== metric.defaultDenominator)
                      .map((denominator) => denominatorLabel(denominator, metric.rateScale))
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {[
          caveat(catalogue, 'population-denominator'),
          caveat(catalogue, 'claimants-population-year'),
        ].map((text) => (text === undefined ? null : <Caveat key={text}>{text}</Caveat>))}
      </Block>

      <Block id="prices" index="02" title="How do we adjust for inflation?">
        <p>
          Every data file holds cash pounds, not adjusted for inflation. Pages show{' '}
          {basisLabel('real-gdp', priceBase)} by default. We adjust them with the GDP deflator, as
          DWP and the Office for Budget Responsibility do. You can switch to CPI inflation or to
          cash.
        </p>
        <p>
          To adjust a figure, we multiply the cash value by the factor for its year. The {priceBase}{' '}
          factors are exactly 1.
        </p>
        <Formula label="Real terms">
          <var>real</var> = <var>cash</var> × <var>factor</var>
          <sub>year</sub>
        </Formula>
        <div className="numbers__scroll">
          <table className="ledger-table">
            <caption className="ledger-table__caption">Price factors to {priceBase} prices</caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col">GDP deflator</th>
                <th scope="col">CPI</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.fiscalYears.map((year) => (
                <tr key={year.id}>
                  <th scope="row" className="tabular">
                    {year.id}
                  </th>
                  <td className="tabular">{year.realGdp.toFixed(4)}</td>
                  <td className="tabular">{year.realCpi.toFixed(4)}</td>
                  <td>{year.status === 'forecast' ? 'Forecast' : 'Actual'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block id="provenance" index="03" title="Which figures are estimates?">
        <p>
          Some figures are published for each area. Others are shared out from a larger area by
          population, worked out from the number of people claiming and their average payment, or
          taken from a survey.
        </p>
        <p>
          Every figure keeps a label that says which kind it is. Estimates have dots on charts and a
          label in text and tables.
        </p>
        <dl className="methods-flags">
          {FLAG_NOTES.map(([flag, label, note]) => (
            <div key={flag}>
              <dt>{label}</dt>
              <dd>{note}</dd>
            </div>
          ))}
        </dl>
        {['scotland-apportioned', 'constituency-history', 'spend-abroad'].map((id) => {
          const text = caveat(catalogue, id)
          return text === undefined ? null : <Caveat key={id}>{text}</Caveat>
        })}
      </Block>

      <Block id="scotland" index="04" title="How do we include Scotland?">
        <p>
          Social Security Scotland now pays some benefits that DWP pays in England and Wales. We put
          each one in the same group as the DWP benefit it replaces. A group uses DWP figures for
          England and Wales and Social Security Scotland figures for Scotland. It never uses both
          for the same benefit and month.
        </p>
        <p>Northern Ireland runs its own benefits, so it is not included.</p>
        <div className="numbers__scroll">
          <table className="ledger-table">
            <caption className="ledger-table__caption">Benefit groups and what is in them</caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Benefit</th>
                <th scope="col">Paid by</th>
                <th scope="col">Nations</th>
                <th scope="col">Years</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.families.flatMap((family) =>
                family.members.map((member, i) => (
                  <tr key={`${family.id}-${member.code}`}>
                    <th scope="row">{i === 0 ? family.label : ''}</th>
                    <td>{member.label}</td>
                    <td>{member.administrator === 'SSS' ? 'Social Security Scotland' : 'DWP'}</td>
                    <td>{member.nations.map((nation) => NATION_LABEL[nation]).join(', ')}</td>
                    <td className="tabular">
                      {member.from ?? 'from the start'}
                      {member.to === null ? ' onwards' : ` to ${member.to}`}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        {['scotland-harmonised', 'scotland-agency-modelled', 'scotland-caseload-month'].map(
          (id) => {
            const text = caveat(catalogue, id)
            return text === undefined ? null : <Caveat key={id}>{text}</Caveat>
          },
        )}
      </Block>

      <Block id="ranks" index="05" title="How do ranks work?">
        <p>
          Rank 1 is the highest value among areas of the same type in Great Britain. Areas with
          equal values share the higher rank. We do not rank a figure when fewer than 1,000 people
          are in the age group, when the source does not publish it, or when it covers only some
          benefits in its group.
        </p>
        <p>
          Sentences say where a rank sits as a share of the other ranked areas, rounded down. For
          example, &apos;higher than in 82% of constituencies&apos;.
        </p>
        <p>
          A Great Britain figure is the Great Britain total divided by the Great Britain population
          in the same age group. We add up both from council figures. Constituency and council pages
          show the same Great Britain figure for each measure.
        </p>
        <p>{caveat(catalogue, 'deprivation-within-nation')}</p>
      </Block>

      <Block id="decomposition" index="06" title="What made spending change?">
        <p>
          Spending on a benefit can change for three reasons. More or fewer people may live in the
          area. A larger or smaller share of them may claim. Or the average payment may go up or
          down.
        </p>
        <p>
          We split each change into these three parts. Together, the parts add up to the whole
          change. We work them out from monthly counts of people claiming and their payments, so the
          spending here is an estimate, not the amount paid out.
        </p>
        <div className="numbers__scroll">
          <table className="ledger-table">
            <caption className="ledger-table__caption">
              Great Britain, constituency sums, {basisLabel('real-gdp', priceBase)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Benefit</th>
                <th scope="col">Months</th>
                <th scope="col">Change</th>
                <th scope="col">{EFFECT_LABEL.population}</th>
                <th scope="col">{EFFECT_LABEL.claimRate}</th>
                <th scope="col">{EFFECT_LABEL.awardSize}</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.decomposition.families.map((entry) => {
                const gbInputs = entry.gb.constituency
                if (gbInputs === undefined) return null
                const effects = decompose(gbInputs, entry, 'real-gdp', factors)
                const label = catalogue.families.find((family) => family.id === entry.family)?.label
                return (
                  <tr key={entry.family}>
                    <th scope="row">
                      {label}
                      <span className="ledger-table__sub">
                        {entry.claimantUnit === 'households' ? 'Households' : 'People'} counted,
                        rate {denominatorLabel(entry.denominator, 1000)};{' '}
                        {entry.nations.map((nation) => NATION_LABEL[nation]).join(', ')}
                      </span>
                    </th>
                    <td>
                      {formatMonth(entry.from)} to {formatMonth(entry.to)}
                    </td>
                    <td className="tabular">{money(effects.change)}</td>
                    <td className="tabular">{money(effects.population)}</td>
                    <td className="tabular">{money(effects.claimRate)}</td>
                    <td className="tabular">{money(effects.awardSize)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <h3 className="kicker mt-4">Technical detail</h3>
        <p>{catalogue.decomposition.method}</p>
        <Formula label="Yearly spending at the current rate">
          <var>V</var> = <var>P</var> × <var>R</var> × <var>A</var> × 52
        </Formula>
        <Formula label="Each part, with L the logarithmic mean">
          <var>effect</var>
          <sub>X</sub> = <var>L</var>(<var>V</var>
          <sub>1</sub>, <var>V</var>
          <sub>0</sub>) × ln(<var>X</var>
          <sub>1</sub> / <var>X</var>
          <sub>0</sub>), &nbsp; <var>L</var>(<var>a</var>, <var>b</var>) = (<var>a</var> −{' '}
          <var>b</var>) / (ln <var>a</var> − ln <var>b</var>)
        </Formula>
      </Block>

      <Block id="expected" index="07" title="How do we work out the expected level?">
        <p>
          We compare each area's spending with the level we would expect for an area like it. We
          work out that level from every area of the same type in Great Britain.
        </p>
        <p>
          The expected level allows for the share of children, the share of people aged 66 and over,
          how deprived the area is, typical pay and which nation it is in. An area above it spends
          more than areas like it. An area below it spends less.
        </p>
        <p>
          The expected level leaves out rents, disability, household make-up and how many people who
          could claim do so. So a difference does not measure need.
        </p>
        <h3 className="kicker mt-4">Technical detail</h3>
        <p>{expected.method}</p>
        <Formula label={`Fitted for ${expected.period}, separately for each level`}>
          <var>spending per person</var> = <var>b</var>
          <sub>0</sub> + <var>b</var>
          <sub>1</sub> share aged 0 to 15 + <var>b</var>
          <sub>2</sub> share aged 66 and over + <var>b</var>
          <sub>3</sub> deprivation decile + <var>b</var>
          <sub>4</sub> ln(median pay) + <var>b</var>
          <sub>5</sub> Wales + <var>b</var>
          <sub>6</sub> Scotland
        </Formula>
        {expected.fits.map((fit) => {
          const metric = catalogue.metrics.find((entry) => entry.id === fit.actualMetric)
          const levels = GeoLevel.options.flatMap((level) => {
            const levelFit = fit.levels[level]
            return levelFit === undefined ? [] : [[level, levelFit] as const]
          })
          return (
            <div key={fit.metric} className="numbers__scroll">
              <table className="ledger-table">
                <caption className="ledger-table__caption">
                  {metric?.label}, {denominatorLabel(fit.denominator, 1)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Term</th>
                    {levels.map(([level]) => (
                      <th key={level} scope="col">
                        {capitalise(LEVEL_LABEL[level].many)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(levels[0]?.[1].terms ?? []).map((term, i) => (
                    <tr key={term.id}>
                      <th scope="row">{term.label}</th>
                      {levels.map(([level, levelFit]) => {
                        const value = levelFit.terms[i]
                        return (
                          <td key={level} className="tabular">
                            {value === undefined
                              ? ''
                              : `${value.coefficient.toLocaleString('en-GB', { maximumFractionDigits: 1 })} (${value.standardError.toLocaleString('en-GB', { maximumFractionDigits: 1 })})`}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="ledger-table__total">
                    <th scope="row">Areas included; R²</th>
                    {levels.map(([level, levelFit]) => (
                      <td key={level} className="tabular">
                        {levelFit.observations}; {levelFit.rSquared.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}
        <p className="text-sm text-ink-muted">
          Coefficients are in cash pounds per person for {expected.period}, with standard errors in
          brackets. Inputs: {expected.inputs.map(inputLabel).join('; ')}.
        </p>
        {caveat(catalogue, 'modelled-comparison') === undefined ? null : (
          <Caveat>{caveat(catalogue, 'modelled-comparison')}</Caveat>
        )}
      </Block>

      <Block id="neighbours" index="08" title="How do we find similar areas?">
        <p>{neighbours.method}</p>
        <ul className="methods-list">
          {neighbours.features.map((feature) => (
            <li key={feature}>{inputLabel(feature)}</li>
          ))}
        </ul>
        <p>Each area page lists the {neighbours.count} most similar areas.</p>
      </Block>

      <Block id="copy" index="09" title="Which words and colours do we use?">
        <p>
          Our sentences compare an area with others. Each one names the measure, what it is divided
          by and the period. They never judge.
        </p>
        <p>
          We publish a list of words that judge rather than describe. Before each release, we check
          every sentence template and every page against it, and against a list of metaphors and
          filler words. We label income tax as income tax only. No page says an area pays in more or
          less than it receives.
        </p>
        <p>
          We name parties in words, never by colour. Maps shade from light to dark as the value
          rises, and no chart uses red and green. You can see prices in {COUNT_WORDS[BASES.length]}{' '}
          ways, and ranks stay the same whichever you choose.
        </p>
      </Block>

      <Block id="issues" index="10" title="What are the limits of the data?">
        <p>Every limit of the data in this release, as it appears on the pages it applies to.</p>
        {catalogue.caveats.map((entry) => (
          <Caveat key={entry.id}>{entry.text}</Caveat>
        ))}
      </Block>

      <Block id="sources" index="11" title="Sources">
        <p>Every source in this release, with its publisher, date and licence.</p>
        <SourceList sources={notes.list()} release={catalogue.release} />
      </Block>
    </article>
  )
}
