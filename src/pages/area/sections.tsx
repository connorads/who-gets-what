/**
 * The dossier's charts, each with its table. The area page shows them all;
 * an embed shows one.
 */
import type { AreaView, FactView, SeriesView } from '#/content/area.ts'
import { perBasis } from '#/content/figures.ts'
import { BASES } from '#/content/labels.ts'
import { formatShare, moneyInWords } from '#/lib/format.ts'
import { Difference } from '#/viz/svg/Difference.tsx'
import { Sparkline } from '#/viz/svg/Sparkline.tsx'
import { Waffle, waffleColumns } from '#/viz/svg/Waffle.tsx'
import {
  BasisBar,
  BasisNote,
  BasisText,
  Caveat,
  Chips,
  FigureText,
  NumbersTable,
  Refs,
  Section,
  ShareBar,
} from '../parts.tsx'

const familyColour = (family: string) => `var(--family-${family})`

/** Position on a track from lowest (left) to highest (right). */
function RankTrack({ fact }: { fact: FactView }) {
  if (fact.standing === null) return null
  const { rank, rankOf } = fact.standing
  const at = rankOf > 1 ? (rankOf - rank) / (rankOf - 1) : 0.5
  return (
    <span className="rank-track" aria-hidden="true">
      <span className="rank-track__line" />
      <span className="rank-track__mark" style={{ left: `${at * 100}%` }} />
      <span className="rank-track__ends">
        <span>Lowest</span>
        <span>Highest</span>
      </span>
    </span>
  )
}

export function GlanceSection({ view }: { view: AreaView }) {
  return (
    <Section
      id="glance"
      kicker="At a glance"
      title={`How does ${view.name} compare?`}
      intro={
        <p>
          We divide each type of spending by the people it is for. A rank of 1 is the highest of the{' '}
          {view.levelLabel.many} in Great Britain. Money is in{' '}
          <BasisNote priceBase={view.priceBase} />.
        </p>
      }
    >
      <ul className="glance">
        {view.glance.map((fact) => (
          <li key={fact.metric} className="glance__tile">
            <p className="kicker">{fact.shortLabel}</p>
            <p className="glance__value tabular">
              <FigureText figure={fact.value} />
            </p>
            <p className="glance__denominator">
              {fact.denominatorText}, {fact.periodText}
              <Refs sources={fact.sources} />
            </p>
            <RankTrack fact={fact} />
            <p className="glance__rank">
              <a href={`${fact.rankHref}#${view.code}`}>{fact.rankText}</a>
              {fact.comparison === null ? null : <span>, {fact.comparison}</span>}
            </p>
            <p className="glance__gb">
              Great Britain: <FigureText figure={fact.gb} empty="not published" />
            </p>
            {fact.derived ? <Chips kinds={fact.kinds} /> : null}
          </li>
        ))}
      </ul>
      <NumbersTable caption={`Main figures for ${view.name}`}>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Value</th>
            <th scope="col">Rank</th>
            <th scope="col">Great Britain</th>
          </tr>
        </thead>
        <tbody>
          {view.glance.map((fact) => (
            <tr key={fact.metric}>
              <th scope="row">
                {fact.label}, {fact.denominatorText}, {fact.periodText}
              </th>
              <td className="tabular">
                <FigureText figure={fact.value} />
              </td>
              <td className="tabular">{fact.rankText}</td>
              <td className="tabular">
                <FigureText figure={fact.gb} empty="not published" />
              </td>
            </tr>
          ))}
        </tbody>
      </NumbersTable>
    </Section>
  )
}

export function SpendSection({ view }: { view: AreaView }) {
  const { spend } = view
  const cells = Math.round(spend.total['real-gdp'] / 1e6)
  const columns = waffleColumns(cells)
  const max = Math.max(...spend.items.map((item) => item.value['real-cpi']))
  const derived = spend.items.some((item) => item.derived)
  return (
    <Section
      id="spend"
      kicker={`Spending by benefit, ${spend.periodText}`}
      title={`Where does ${view.name}'s benefit money go?`}
      intro={
        <p>
          People here received{' '}
          <BasisText text={perBasis((basis) => moneyInWords(spend.totalText[basis]))} varies /> in
          benefits in {spend.periodText}, in <BasisNote priceBase={view.priceBase} />. Each square
          is £1 million.
          <Refs sources={spend.sources} />
        </p>
      }
    >
      <div className="spend">
        <div className="spend__waffle">
          {BASES.map((basis) => (
            <div key={basis} data-basis={basis}>
              <Waffle
                id={`waffle-${basis}`}
                unit={1e6}
                columns={columns}
                label={`Spending in ${view.name}, ${spend.periodText}, one square per £1 million: ${spend.items
                  .map((item) => `${item.label} ${item.text[basis]}`)
                  .join('; ')}`}
                items={spend.items.map((item) => ({
                  key: item.family,
                  label: `${item.label}: ${item.text[basis]}`,
                  color: familyColour(item.family),
                  value: item.value[basis],
                  derived: item.derived,
                }))}
              />
            </div>
          ))}
          {derived ? (
            <p className="spend__key">
              <span className="halftone-chip" aria-hidden="true" /> Dotted squares are estimates.
            </p>
          ) : null}
        </div>
        <ol className="family-list">
          {spend.items.map((item) => (
            <li key={item.family} className="family-list__row">
              <span
                className="family-list__swatch"
                style={{ background: familyColour(item.family) }}
                aria-hidden="true"
              />
              <span className="family-list__label">{item.label}</span>
              <span className="family-list__value tabular">
                <BasisText text={item.text} varies />
              </span>
              <span className="family-list__share tabular">{formatShare(item.share)}</span>
              <BasisBar
                values={item.value}
                max={max}
                varies
                color={familyColour(item.family)}
                derived={item.derived}
                className="family-list__bar"
              />
              {item.derived ? <Chips kinds={item.kinds} /> : null}
            </li>
          ))}
        </ol>
      </div>
      <NumbersTable caption={`Spending by benefit in ${view.name}, ${spend.periodText}`}>
        <thead>
          <tr>
            <th scope="col">Benefit</th>
            <th scope="col">Spending</th>
            <th scope="col">Share</th>
            <th scope="col">Figure type</th>
          </tr>
        </thead>
        <tbody>
          {spend.items.map((item) => (
            <tr key={item.family}>
              <th scope="row">{item.label}</th>
              <td className="tabular">
                <BasisText text={item.text} varies />
              </td>
              <td className="tabular">{formatShare(item.share)}</td>
              <td>
                <Chips kinds={item.kinds} />
              </td>
            </tr>
          ))}
          <tr className="ledger-table__total">
            <th scope="row">All benefits</th>
            <td className="tabular">
              <BasisText text={spend.totalText} varies />
            </td>
            <td className="tabular">100%</td>
            <td>Total</td>
          </tr>
        </tbody>
      </NumbersTable>
    </Section>
  )
}

function SeriesCard({ series }: { series: SeriesView }) {
  const first = series.points.find((point) => point.value !== null)
  const last = series.points.findLast((point) => point.value !== null)
  return (
    <li className="multiple">
      <p className="multiple__title">{series.title}</p>
      <p className="multiple__denominator">{series.denominatorText}</p>
      <p className="multiple__latest tabular">
        {last === undefined ? 'No value' : <BasisText text={last.text} varies={series.varies} />}
        <span className="multiple__period">{last?.label}</span>
      </p>
      <Sparkline
        points={series.points}
        varies={series.varies}
        label={`${series.title}, ${series.denominatorText}, ${first?.label ?? ''} to ${last?.label ?? ''}`}
      />
      <p className="multiple__axis">
        <span>{first?.label}</span>
        <span>{last?.label}</span>
      </p>
    </li>
  )
}

function SeriesTable({ series, caption }: { series: readonly SeriesView[]; caption: string }) {
  const columns = new Map(
    series.flatMap((entry) => entry.points.map((point) => [point.period, point.label] as const)),
  )
  const periods = [...columns.keys()].toSorted()
  return (
    <NumbersTable caption={caption}>
      <thead>
        <tr>
          <th scope="col">Measure</th>
          {periods.map((period) => (
            <th key={period} scope="col" className="tabular">
              {columns.get(period)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {series.map((entry) => (
          <tr key={entry.metric}>
            <th scope="row">
              {entry.title}, {entry.denominatorText}
            </th>
            {periods.map((period) => {
              const point = entry.points.find((candidate) => candidate.period === period)
              return (
                <td key={period} className="tabular">
                  {point === undefined ? '' : <BasisText text={point.text} varies={entry.varies} />}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </NumbersTable>
  )
}

export function TrendsSection({ view }: { view: AreaView }) {
  const spend = view.series.filter((series) => series.kind === 'spend')
  const claimants = view.series.filter((series) => series.kind === 'claimants')
  return (
    <Section
      id="trends"
      kicker="Trends"
      title="Spending and claims over time"
      intro={
        <p>
          Each small chart starts at zero and has its own scale. Spending is in{' '}
          <BasisNote priceBase={view.priceBase} />. Dotted years are estimates. A dashed line marks
          a change to boundaries or methods.
          <Refs sources={view.series.flatMap((series) => series.sources)} />
        </p>
      }
    >
      <h3 className="multiples__heading kicker">Spending per person in the age group</h3>
      <ul className="multiples">
        {spend.map((series) => (
          <SeriesCard key={series.metric} series={series} />
        ))}
      </ul>
      <SeriesTable series={spend} caption={`Spending trends in ${view.name}`} />
      {claimants.length > 0 ? (
        <>
          <h3 className="multiples__heading kicker">People receiving benefits, per 1,000</h3>
          <ul className="multiples">
            {claimants.map((series) => (
              <SeriesCard key={series.metric} series={series} />
            ))}
          </ul>
          <SeriesTable
            series={claimants}
            caption={`Trends in people receiving benefits in ${view.name}`}
          />
        </>
      ) : null}
    </Section>
  )
}

export function ModelSection({ view }: { view: AreaView }) {
  const { model } = view
  if (model.rows.length === 0) return null
  return (
    <Section
      id="model"
      kicker="Compared with similar areas"
      title="Spending compared with the expected level"
      intro={
        <>
          <p>
            We work out an expected level of spending from the share of children and of people aged
            66 and over, how deprived the area is, typical pay and which nation it is in. This
            compares the area with similar areas. It does not measure need.
          </p>
          <p>
            Each bar starts at the expected level. A bar reaches the edge when the difference is
            larger than in 98% of {view.levelLabel.many}.
          </p>
        </>
      }
    >
      <ul className="model-rows">
        {model.rows.map((row) => (
          <li key={row.metric} className="model-rows__row">
            <p className="model-rows__title">
              {row.title}, {row.denominatorText}
              <Refs sources={row.sources} />
            </p>
            {row.residual === null || row.spread === null ? null : (
              <>
                <Difference
                  value={row.residual}
                  spread={row.spread}
                  label={`${row.title}: actual ${row.actualText['real-gdp']}, expected ${row.expectedText['real-gdp']}, difference ${row.residualText['real-gdp']}`}
                />
                <p className="difference__ends" aria-hidden="true">
                  <span>Below the expected level</span>
                  <span>Expected</span>
                  <span>Above</span>
                </p>
              </>
            )}
            <p className="model-rows__legend tabular">
              <span>
                Actual <BasisText text={row.actualText} varies />
              </span>
              <span>
                Expected <BasisText text={row.expectedText} varies />
              </span>
              <span>
                Difference <BasisText text={row.residualText} varies />
              </span>
            </p>
            <p className="model-rows__sentence">
              {row.sentence === null ? (
                `No expected level: ${row.missing.join(', ').toLowerCase()} is not published for this area.`
              ) : (
                <BasisText text={row.sentence} varies />
              )}
              {row.rSquared === null
                ? null
                : ` Across all ${view.levelLabel.many}, these factors explain ${formatShare(row.rSquared)} of the differences in this measure.`}
            </p>
          </li>
        ))}
      </ul>
      {model.caveat === null ? null : <Caveat>{model.caveat}</Caveat>}
      <p className="text-sm">
        <a href="/methods#expected">How we work out the expected level</a>
      </p>
      <NumbersTable caption={`Actual and expected spending in ${view.name}`}>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Actual</th>
            <th scope="col">Expected</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.metric}>
              <th scope="row">
                {row.title}, {row.denominatorText}
              </th>
              <td className="tabular">
                <BasisText text={row.actualText} varies />
              </td>
              <td className="tabular">
                <BasisText text={row.expectedText} varies />
              </td>
              <td className="tabular">
                <BasisText text={row.residualText} varies />
              </td>
            </tr>
          ))}
        </tbody>
      </NumbersTable>
    </Section>
  )
}

export function NeighboursSection({ view }: { view: AreaView }) {
  const { neighbours } = view
  const max = Math.max(
    ...neighbours.rows.flatMap((row) =>
      row.value === null ? [] : BASES.map((basis) => row.value?.[basis] ?? 0),
    ),
  )
  return (
    <Section
      id="neighbours"
      kicker="Similar areas"
      title={`The ${neighbours.rows.length - 1} ${view.levelLabel.many} most like ${view.name}`}
      intro={
        <p>
          We match areas anywhere in Great Britain on age, deprivation, pay and how many people live
          in each square kilometre. We do not match on place or spending. A smaller score means more
          alike. Bars show {neighbours.title.toLowerCase()} {neighbours.denominatorText},{' '}
          {neighbours.periodText}.
        </p>
      }
    >
      <ol className="neighbours">
        {neighbours.rows.map((row) => (
          <li
            key={row.code}
            className={`neighbours__row${row.self ? ' neighbours__row--self' : ''}`}
          >
            <span className="neighbours__name">
              {row.self ? <strong>{row.name}</strong> : <a href={row.href}>{row.name}</a>}
            </span>
            <span className="neighbours__distance tabular">
              {row.distance === null ? 'This area' : row.distance.toFixed(2)}
            </span>
            <BasisBar
              values={row.value}
              max={max}
              varies
              className={row.self ? 'share-bar--brass' : 'share-bar--ink'}
            />
            <span className="neighbours__value tabular">
              <BasisText text={row.text} varies />
            </span>
            <span className="neighbours__compare">
              {row.compareHref === null ? null : (
                <a href={row.compareHref} aria-label={`Compare ${view.name} with ${row.name}`}>
                  Compare
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>
      {neighbours.missing.length > 0 ? (
        <Caveat>
          {view.name} has no published {neighbours.missing.join(', ').toLowerCase()}, so its scores
          use the other measures.
        </Caveat>
      ) : null}
      <NumbersTable caption={`Areas most like ${view.name}`}>
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col">Score</th>
            <th scope="col">
              {neighbours.title}, {neighbours.denominatorText}
            </th>
          </tr>
        </thead>
        <tbody>
          {neighbours.rows.map((row) => (
            <tr key={row.code}>
              <th scope="row">{row.name}</th>
              <td className="tabular">{row.distance === null ? '' : row.distance.toFixed(2)}</td>
              <td className="tabular">
                <BasisText text={row.text} varies />
              </td>
            </tr>
          ))}
        </tbody>
      </NumbersTable>
    </Section>
  )
}

export function TaxSection({ view }: { view: AreaView }) {
  const { tax } = view
  if (tax === null) return null
  const incomeTax = tax.incomeTax
  return (
    <Section
      id="tax"
      kicker="Income tax only"
      title="Benefit spending and income tax paid by residents"
      intro={
        <p>
          {tax.ratioText === null ? null : <>{tax.ratioText} </>}Both figures are per resident, for
          the same tax year, {tax.periodText}. Income tax is only one tax. There are no area figures
          for National Insurance, VAT or council tax.
        </p>
      }
    >
      <dl className="tax-pair">
        <div className="tax-pair__row">
          <dt>
            Income tax paid by residents (income tax only), per resident
            <Refs sources={incomeTax.sources} />
          </dt>
          <dd className="tabular">
            <FigureText figure={incomeTax.value} />
          </dd>
          <dd>
            <Chips kinds={incomeTax.kinds} />
          </dd>
        </div>
        <div className="tax-pair__row">
          <dt>Benefit spending, per resident</dt>
          <dd className="tabular">
            <FigureText figure={tax.spend} />
          </dd>
          <dd />
        </div>
        <div className="tax-pair__row">
          <dt>
            Benefits for each £1 of income tax
            <Refs sources={tax.ratio.sources} />
          </dt>
          <dd className="tabular">
            <FigureText figure={tax.ratio.value} />
          </dd>
          <dd className="tax-pair__rank">
            {tax.ratio.rankText}
            {tax.ratio.comparison === null ? '' : `, ${tax.ratio.comparison}`}
          </dd>
        </div>
      </dl>
      {tax.caveats.map((text) => (
        <Caveat key={text}>{text}</Caveat>
      ))}
    </Section>
  )
}

export function ConditionsSection({ view }: { view: AreaView }) {
  const { conditions } = view
  if (conditions.kind === 'not-published') return null
  const scale = (share: number) => (conditions.max > 0 ? share / conditions.max : 0)
  return (
    <Section
      id="conditions"
      kicker={`Disability benefit, ${conditions.periodText}`}
      title="Personal Independence Payment by main condition"
      intro={
        <p>
          {conditions.totalText} people in {view.name} receive Personal Independence Payment (PIP).
          This shows the main condition each person has, compared with {conditions.comparisonLabel}.
          Every bar uses the same scale.
          <Refs sources={conditions.sources} />
        </p>
      }
    >
      <p className="condition-key" aria-hidden="true">
        <span>
          <span className="condition-key__swatch condition-key__swatch--area" />
          {view.name}
        </span>
        <span>
          <span className="condition-key__swatch" />
          {conditions.comparisonLabel}
        </span>
      </p>
      <ul className="multiples">
        {conditions.main.map((row) => (
          <li key={row.id} className="multiple condition">
            <p className="multiple__title">{row.label}</p>
            <p className="multiple__latest tabular">{row.shareText}</p>
            <ShareBar
              share={row.share === null ? 0 : scale(row.share)}
              className="share-bar--brass"
            />
            <ShareBar share={scale(row.comparison)} className="share-bar--ink" />
            <p className="multiple__denominator">
              {conditions.comparisonLabel}: {row.comparisonText}
            </p>
          </li>
        ))}
      </ul>
      {conditions.caveat === null ? null : <Caveat>{conditions.caveat}</Caveat>}
      <NumbersTable
        caption={`Personal Independence Payment by main disabling condition in ${view.name}`}
      >
        <thead>
          <tr>
            <th scope="col">Condition group</th>
            <th scope="col">People</th>
            <th scope="col">Share</th>
            <th scope="col">{conditions.comparisonLabel}</th>
          </tr>
        </thead>
        <tbody>
          {conditions.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              <td className="tabular">{row.claimantsText}</td>
              <td className="tabular">{row.shareText}</td>
              <td className="tabular">{row.comparisonText}</td>
            </tr>
          ))}
        </tbody>
      </NumbersTable>
    </Section>
  )
}

export function ElectionSection({ view }: { view: AreaView }) {
  const { election } = view
  if (election === null) return null
  return (
    <Section
      id="election"
      kicker={`General election, ${election.dateText}`}
      title={`How did ${view.name} vote in 2024?`}
      intro={
        <p>
          Shares of the {election.validVotesText} valid votes.
          <Refs sources={election.sources} />
        </p>
      }
    >
      <dl className="tax-pair">
        <div className="tax-pair__row">
          <dt>Winning party</dt>
          <dd>{election.winner.party}</dd>
          <dd translate="no">{election.winner.name}</dd>
        </div>
        <div className="tax-pair__row">
          <dt>Majority</dt>
          <dd className="tabular">{election.majorityText}</dd>
          <dd>{election.majorityShareText} of valid votes</dd>
        </div>
        <div className="tax-pair__row">
          <dt>Turnout</dt>
          <dd className="tabular">{election.turnoutText}</dd>
          <dd>Valid votes as a share of the {election.electorateText} people registered to vote</dd>
        </div>
      </dl>
      <ul className="age-bands">
        {election.candidates.map((candidate) => (
          <li key={`${candidate.party}-${candidate.name}`} className="age-bands__row">
            <span>{candidate.party}</span>
            <ShareBar share={candidate.share} className="share-bar--ink" />
            <span className="tabular">{candidate.votesText}</span>
            <span className="tabular age-bands__share">{candidate.shareText}</span>
          </li>
        ))}
      </ul>
      {election.caveat === null ? null : <Caveat>{election.caveat}</Caveat>}
      <NumbersTable caption={`General election results in ${view.name}, ${election.dateText}`}>
        <thead>
          <tr>
            <th scope="col">Party</th>
            <th scope="col">Candidate</th>
            <th scope="col">Votes</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {election.candidates.map((candidate) => (
            <tr key={`${candidate.party}-${candidate.name}`}>
              <th scope="row">{candidate.party}</th>
              <td translate="no">{candidate.name}</td>
              <td className="tabular">{candidate.votesText}</td>
              <td className="tabular">{candidate.shareText}</td>
            </tr>
          ))}
        </tbody>
      </NumbersTable>
    </Section>
  )
}

export function OverlapsSection({ view }: { view: AreaView }) {
  if (view.overlaps.length === 0) return null
  const other = view.level === 'constituency' ? 'local authorities' : 'constituencies'
  return (
    <Section
      id="overlaps"
      kicker="Overlapping areas"
      title={`The ${other} that overlap ${view.name}`}
      intro={<p>Each share is the part of {view.name}&apos;s residents who live in that area.</p>}
    >
      <ul className="overlaps">
        {view.overlaps.map((overlap) => (
          <li key={overlap.href} className="overlaps__row">
            <a href={overlap.href}>{overlap.name}</a>
            <span className="overlaps__level">{overlap.levelText}</span>
            <BasisBar
              values={perBasis(() => overlap.share)}
              max={1}
              varies={false}
              className="share-bar--ink"
            />
            <span className="tabular">{overlap.shareText}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function FactsSection({ view }: { view: AreaView }) {
  return (
    <Section
      id="figures"
      kicker="Every figure"
      title="Every figure, with its rank"
      intro={
        <p>
          Every figure we publish for {view.name}, in total and per person. Each has its rank among
          the {view.levelLabel.many} of Great Britain and the figure for Great Britain. Money is in{' '}
          <BasisNote priceBase={view.priceBase} />.
        </p>
      }
    >
      {view.facts.map((group) => (
        <div key={group.title} className="numbers__scroll">
          <table className="ledger-table ledger-table--facts">
            <caption className="ledger-table__caption">
              {group.title}
              <Refs sources={group.rows.flatMap((fact) => fact.sources)} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Value</th>
                <th scope="col">Rank</th>
                <th scope="col">Great Britain</th>
                <th scope="col">Figure type</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((fact) => (
                <tr key={`${fact.metric}-${fact.denominator}`}>
                  <th scope="row">
                    <span className="block">{fact.shortLabel}</span>
                    <span className="ledger-table__sub">
                      {fact.denominatorText}, {fact.periodText}
                    </span>
                  </th>
                  <td className="tabular">
                    <FigureText figure={fact.value} />
                  </td>
                  <td className="tabular">
                    {fact.standing === null ? (
                      fact.rankText
                    ) : (
                      <a href={`${fact.rankHref}#${view.code}`}>{fact.rankText}</a>
                    )}
                  </td>
                  <td className="tabular">
                    <FigureText figure={fact.gb} empty="" />
                  </td>
                  <td>
                    <Chips kinds={fact.kinds} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="mt-6 flex flex-wrap items-center gap-x-3 text-sm">
        <button
          type="button"
          className="action-button"
          hidden
          data-download-area={view.level}
          data-code={view.code}
        >
          Download these figures (CSV)
        </button>
        <output data-download-status="" className="text-ink-muted" />
        <a href="/data">Download all the data</a>
      </p>
    </Section>
  )
}
