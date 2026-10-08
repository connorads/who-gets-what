import type { RankTable, RankView } from '#/content/rank.ts'
import { NATION_LABEL } from '#/content/labels.ts'
import { capitalise } from '#/content/sentences.ts'
import { perLabel } from '#/domain/measure.ts'
import { BasisPicker, BasisNote, Caveat, Chips, FigureText, Refs, SourceList } from '../parts.tsx'

function SortButton({ by, children }: { by: string; children: string }) {
  return (
    <button type="button" data-sort={by} className="sort-button">
      {children}
    </button>
  )
}

function Table({ view, table }: { view: RankView; table: RankTable }) {
  const tableId = `rank-${table.level}`
  return (
    <section
      data-level-panel={table.level}
      data-table-scope=""
      aria-labelledby={`${tableId}-title`}
      className="rank-panel"
    >
      <header className="rank-panel__head">
        <h2 id={`${tableId}-title`} className="font-display text-title">
          {table.rankOf.toLocaleString('en-GB')} {table.levelLabel.many} ranked, {table.periodText}
        </h2>
        <p className="rank-panel__gb">
          Great Britain: <FigureText figure={table.gb} empty="not published" />{' '}
          <span className="text-ink-muted">{perLabel(view.metric, view.denominator)}</span>
        </p>
      </header>
      <div className="rank-panel__filters">
        <label>
          <span className="kicker">Nation</span>
          <select data-filter="nation" defaultValue="">
            <option value="">Great Britain</option>
            {Object.entries(NATION_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {table.level === 'constituency' ? (
          <label>
            <span className="kicker">Region</span>
            <select data-filter="region" defaultValue="">
              <option value="">All regions</option>
              {table.regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <output data-filter-count="" className="rank-panel__count">
          {table.rows.length.toLocaleString('en-GB')} shown
        </output>
        <a className="action-link" href={table.exploreHref}>
          See it on the map
        </a>
      </div>
      {table.derivedCount > 0 ? (
        <Caveat>
          {table.derivedCount.toLocaleString('en-GB')} figures are estimates or are shared out from
          larger areas. Their ranks are less certain than published figures. A small change in the
          estimate can move an area several places.
        </Caveat>
      ) : null}
      <div className="numbers__scroll">
        <table className="ledger-table rank-table" id={tableId}>
          <caption className="sr-only">
            {view.title}, {table.periodText}, {table.levelLabel.many}
          </caption>
          <thead>
            <tr>
              <th scope="col" aria-sort="ascending">
                <SortButton by="rank">Rank</SortButton>
              </th>
              <th scope="col">
                <SortButton by="name">Area</SortButton>
              </th>
              <th scope="col">{table.level === 'constituency' ? 'Region' : 'Nation'}</th>
              <th scope="col">
                <SortButton by="value">Value</SortButton>
              </th>
              <th scope="col">Figure type</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.code}
                id={row.code}
                data-rank={row.rank ?? ''}
                data-value={
                  row.value === null ? '' : -Math.round(row.value['real-gdp'] * 100) / 100
                }
                data-nation={row.nation}
                data-region={row.region}
                className={row.band === null ? undefined : `rank-table__${row.band}`}
              >
                <td>{row.rank ?? '-'}</td>
                <th scope="row">
                  <a href={row.href}>{row.name}</a>
                  {row.band === null ? null : (
                    <span className="rank-table__band">
                      {row.band === 'highest' ? 'Highest 10' : 'Lowest 10'}
                    </span>
                  )}
                </th>
                <td>{table.level === 'constituency' ? row.regionName : row.nationLabel}</td>
                <td>
                  <FigureText figure={row.figure} />
                  {row.unranked === null ? null : (
                    <span className="ledger-table__sub">{row.unranked}</span>
                  )}
                </td>
                <td>{row.derived ? <Chips kinds={row.kinds} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function RankPage({ view }: { view: RankView }) {
  return (
    <article className="rank-scope basis-scope">
      <header className="rank-head">
        <p className="kicker">
          <a href="/rank">Rankings</a> · {view.metric.shortLabel}
        </p>
        <h1 className="rank-head__title">
          {view.metric.label}
          {view.denominatorText === '' ? null : `, ${view.denominatorText}`}
        </h1>
        <p className="rank-head__lede">
          {view.metric.description}
          <Refs sources={view.sources.map((source) => source.n)} />
        </p>
        <p className="rank-head__note">
          Rank 1 is the highest value.{' '}
          {view.money ? (
            <>
              Money is in <BasisNote priceBase={view.priceBase} explained />.{' '}
            </>
          ) : null}
          Some areas have no rank. This is because fewer than 1,000 people are in the age group, the
          source does not publish the figure, or it covers only some benefits.
        </p>
        {view.others.length > 0 ? (
          <p className="rank-head__others">
            <span className="kicker">Same measure, counted another way</span>{' '}
            {view.others.map((other, i) => (
              <span key={other.href}>
                {i > 0 ? ' · ' : ''}
                <a href={other.href}>{other.label}</a>
              </span>
            ))}
          </p>
        ) : null}
      </header>

      <div className="rank-controls">
        <fieldset className="basis-picker level-picker">
          <legend className="kicker">Area type</legend>
          <div className="basis-picker__options">
            {view.tables.map((table) => (
              <label key={table.level} className="basis-picker__option">
                <input
                  type="radio"
                  name="level"
                  value={table.level}
                  defaultChecked={table.level === 'constituency'}
                  className="sr-only"
                />
                <span>{capitalise(table.levelLabel.many)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {view.money ? <BasisPicker priceBase={view.priceBase} /> : null}
      </div>

      {view.tables.map((table) => (
        <Table key={table.level} view={view} table={table} />
      ))}

      <section aria-labelledby="rank-notes" className="dossier-section">
        <h2 id="rank-notes" className="font-display text-title">
          Limits and sources
        </h2>
        {view.caveats.map((text) => (
          <Caveat key={text}>{text}</Caveat>
        ))}
        <SourceList sources={view.sources} release={view.release} />
      </section>
    </article>
  )
}
