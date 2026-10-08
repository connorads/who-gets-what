import type { ReactNode } from 'react'
import type { AreaView } from '#/content/area.ts'
import { EMBED_CHARTS, embedCode } from '#/content/embed.ts'
import { formatShare } from '#/lib/format.ts'
import { HexLocator } from '#/viz/svg/HexLocator.tsx'
import { BasisPicker, Caveat, Refs, Section, ShareBar, SourceList } from '../parts.tsx'
import {
  ConditionsSection,
  ElectionSection,
  FactsSection,
  GlanceSection,
  ModelSection,
  NeighboursSection,
  OverlapsSection,
  SpendSection,
  TaxSection,
  TrendsSection,
} from './sections.tsx'

export interface LocatorCells {
  readonly cells: readonly { readonly code: string; readonly q: number; readonly r: number }[]
}

/** A closed section: a plain-English question until the reader opens it. */
function Fold({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className="fold">
      <summary className="fold__summary">{question}</summary>
      <div className="fold__body">{children}</div>
    </details>
  )
}

function ProfileSection({ view }: { view: AreaView }) {
  const { deprivation, population } = view
  const widest = Math.max(...population.bands.map((band) => band.share))
  return (
    <Section
      id="profile"
      kicker="Profile"
      title="Deprivation and age"
      intro={
        <p>
          England, Wales and Scotland each measure deprivation in their own way. So we compare{' '}
          {view.name} only with other areas in {view.nationLabel}.
        </p>
      }
    >
      {deprivation === null ? (
        <p>No deprivation figure is published for this area.</p>
      ) : (
        <figure className="decile">
          <ol className="decile__strip" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((decile) => (
              <li
                key={decile}
                className={`decile__cell${decile === deprivation.decile ? ' decile__cell--on' : ''}`}
              >
                {decile}
              </li>
            ))}
          </ol>
          <p className="decile__ends" aria-hidden="true">
            <span>Most deprived tenth</span>
            <span>Least deprived tenth</span>
          </p>
          <figcaption>
            Group {deprivation.decile} of 10 in {deprivation.nationLabel}, where group 1 is the most
            deprived tenth of areas. {deprivation.indexTitle}.
            <Refs sources={deprivation.sources} />
          </figcaption>
        </figure>
      )}
      <h3 className="kicker mt-8">Residents by age, {population.periodText}</h3>
      <ul className="age-bands">
        {population.bands.map((band) => (
          <li key={band.label} className="age-bands__row">
            <span>{band.label}</span>
            <ShareBar share={widest > 0 ? band.share / widest : 0} className="share-bar--ink" />
            <span className="tabular">{band.value}</span>
            <span className="tabular age-bands__share">{formatShare(band.share)}</span>
          </li>
        ))}
        <li className="age-bands__row age-bands__row--total">
          <span>All residents</span>
          <span />
          <span className="tabular">{population.total}</span>
          <span className="tabular age-bands__share">100%</span>
        </li>
      </ul>
    </Section>
  )
}

function EmbedPanel({ view }: { view: AreaView }) {
  const first = EMBED_CHARTS[0]
  return (
    <div className="embed-panel" data-embed="">
      <div className="embed-panel__body">
        <label className="embed-panel__field">
          <span className="kicker">Chart</span>
          <select data-embed-chart="" defaultValue={first.id}>
            {EMBED_CHARTS.map((chart) => (
              <option
                key={chart.id}
                value={chart.id}
                data-code={embedCode(view.level, view.code, view.name, chart.id)}
              >
                {chart.label}
              </option>
            ))}
          </select>
        </label>
        <textarea
          readOnly
          rows={4}
          data-embed-code=""
          aria-label="Embed code"
          defaultValue={embedCode(view.level, view.code, view.name, first.id)}
        />
        <button type="button" className="action-button" data-copy="[data-embed-code]">
          Copy embed code
        </button>
        <output className="embed-panel__note" data-copy-status="" />
      </div>
    </div>
  )
}

export function AreaPage({ view, locator }: { view: AreaView; locator: LocatorCells }) {
  const compare = view.neighbours.rows[1]
  return (
    <article className="dossier basis-scope" data-area={view.code}>
      <header className="dossier-head">
        <div className="dossier-head__text">
          <p className="dossier-head__where">
            {view.levelLabel.title} in {view.regionName}
            {view.regionName === view.nationLabel ? '' : `, ${view.nationLabel}`}
          </p>
          <h1 className="dossier-head__name" style={{ viewTransitionName: `area-${view.code}` }}>
            {view.name}
          </h1>
          <div className="dossier-head__lede">
            {view.headline.slice(0, 1).map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
          <p className="dossier-head__meta">
            {view.population.total} residents ({view.population.periodText})
            {view.representation === null ? null : (
              <>
                {' '}
                · Member of Parliament: <span translate="no">
                  {view.representation.member}
                </span>,{' '}
                {view.representation.party}, since {view.representation.since}
              </>
            )}
          </p>
          <div className="dossier-head__actions">
            <a className="pill pill--tone" href={view.exploreHref}>
              See it on the map
            </a>
            {compare?.compareHref == null ? null : (
              <a className="pill" href={compare.compareHref}>
                Compare with {compare.name}
              </a>
            )}
          </div>
        </div>
        <div className="dossier-head__locator">
          <HexLocator
            cells={locator.cells}
            selected={[view.code]}
            label={`${view.name} on a map of the ${view.levelLabel.many} of Great Britain, one hexagon each`}
          />
        </div>
      </header>

      <div className="dossier-main">
        <BasisPicker priceBase={view.priceBase} />
        <GlanceSection view={view} />
        <SpendSection view={view} />

        <div className="folds">
          <h2 className="folds__title">More about {view.name}</h2>
          <Fold question="How has it changed over time?">
            <TrendsSection view={view} />
          </Fold>
          {view.model.rows.length > 0 ? (
            <Fold question="Is spending what you would expect?">
              <ModelSection view={view} />
            </Fold>
          ) : null}
          {view.tax === null ? null : (
            <Fold question="How much income tax do residents pay?">
              <TaxSection view={view} />
            </Fold>
          )}
          <Fold question="Who lives here?">
            <ProfileSection view={view} />
          </Fold>
          {view.conditions.kind === 'not-published' ? (
            <p className="folds__note">{view.conditions.reason}</p>
          ) : (
            <Fold question="Which conditions are disability benefits paid for?">
              <ConditionsSection view={view} />
            </Fold>
          )}
          {view.election === null ? null : (
            <Fold question="Who was elected here in 2024?">
              <ElectionSection view={view} />
            </Fold>
          )}
          <Fold question="Which areas are most like this one?">
            <NeighboursSection view={view} />
          </Fold>
          {view.overlaps.length === 0 ? null : (
            <Fold question="Which other areas overlap it?">
              <OverlapsSection view={view} />
            </Fold>
          )}
          <Fold question="Every figure, in one table">
            <FactsSection view={view} />
          </Fold>
          <Fold question="Where do the numbers come from?">
            <Section id="notes" kicker="Notes" title="Limits and sources">
              <h3 className="kicker">Limits of the figures for {view.name}</h3>
              {view.caveats.map((caveat) => (
                <Caveat key={caveat.id}>{caveat.text}</Caveat>
              ))}
              <h3 className="kicker mt-8">Sources</h3>
              <SourceList sources={view.sources} release={view.release} />
              <p className="mt-6 text-sm text-ink-muted">
                Northern Ireland is not included.{' '}
                <a href="/methods">How we worked out the figures</a> ·{' '}
                <a href="/data">Download all the data</a>
              </p>
            </Section>
          </Fold>
          <Fold question="Share or embed a chart">
            <EmbedPanel view={view} />
          </Fold>
        </div>
      </div>
    </article>
  )
}
