import type { AreasMeta } from '#/domain/contract.ts'
import { areaPath, LEVEL_LABEL } from '#/content/labels.ts'
import { capitalise } from '#/content/sentences.ts'

function LevelList({ meta }: { meta: AreasMeta }) {
  const label = LEVEL_LABEL[meta.level]
  const groups = meta.regions
    .map((region) => ({
      region,
      areas: meta.areas
        .filter((area) => area.region === region.code)
        .toSorted((a, b) => a.name.localeCompare(b.name, 'en-GB')),
    }))
    .filter((group) => group.areas.length > 0)
  return (
    <section
      aria-labelledby={`areas-${meta.level}`}
      data-level-label={label.one}
      className="area-index__level"
    >
      <h2 id={`areas-${meta.level}`} className="font-display text-title">
        {meta.areas.length.toLocaleString('en-GB')} {label.many}
      </h2>
      {groups.map((group) => (
        <div key={group.region.code} data-search-group="" className="area-index__group">
          <h3 className="kicker">{group.region.name}</h3>
          <ul className="area-index__list">
            {group.areas.map((area) => (
              <li key={area.code} data-name={area.name.toLowerCase()} data-code={area.code}>
                <a href={areaPath(meta.level, area)}>{area.name}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export function AreaIndexPage({ levels }: { levels: readonly AreasMeta[] }) {
  return (
    <article data-search-scope="">
      <header className="pt-12 pb-4 md:pt-20 md:pb-8">
        <p className="kicker">Areas</p>
        <h1 className="mt-4 max-w-[18ch] font-display text-headline text-balance">
          Find your area
        </h1>
        <div className="mt-6 max-w-prose text-lg text-pretty text-ink-muted">
          <p>
            Every constituency and council in Great Britain has its own page. Each page shows the
            latest figures and how they rank, spending on each benefit, changes over time and
            similar areas.
          </p>
        </div>
      </header>

      <div className="area-finder">
        <form data-postcode="" className="area-finder__form" action="#">
          <label htmlFor="postcode" className="kicker">
            Postcode
          </label>
          <div className="area-finder__row">
            <input
              id="postcode"
              name="postcode"
              autoComplete="postal-code"
              placeholder="For example GU11 1AA"
              className="area-finder__input"
            />
            <button type="submit" className="action-button">
              Find
            </button>
          </div>
          <output data-postcode-status="" aria-live="polite" className="area-finder__status" />
          <p className="area-finder__note">
            We send the postcode to postcodes.io, an open lookup service, and do not store it. Great
            Britain only.
          </p>
        </form>
        <div className="area-finder__form">
          <label htmlFor="area-search" className="kicker">
            Name
          </label>
          <input
            id="area-search"
            type="search"
            data-area-search=""
            placeholder="Type part of a name"
            autoComplete="off"
            className="area-finder__input"
          />
          <output data-search-count="" aria-live="polite" className="area-finder__status" />
        </div>
      </div>

      <div className="area-index">
        {levels.map((meta) => (
          <LevelList key={meta.level} meta={meta} />
        ))}
      </div>
      <p className="mt-10 max-w-prose text-sm text-ink-muted">
        {capitalise(LEVEL_LABEL.constituency.many)} use the 2024 boundaries.{' '}
        {capitalise(LEVEL_LABEL['local-authority'].many)} use the April 2023 boundaries. Northern
        Ireland is not included.
      </p>
    </article>
  )
}
