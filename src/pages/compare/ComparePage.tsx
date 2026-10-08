import { MEASURES, type CompareRow, type CompareView } from '#/content/compare.ts'
import { Dumbbell } from '#/viz/svg/Dumbbell.tsx'
import { HexLocator } from '#/viz/svg/HexLocator.tsx'
import type { LocatorCells } from '../area/AreaPage.tsx'
import {
  BasisPicker,
  BasisNote,
  Chips,
  FigureText,
  NumbersTable,
  Refs,
  SourceList,
} from '../parts.tsx'

function Key({ view }: { view: CompareView }) {
  return (
    <p className="compare-key">
      <span>
        <span className="legend-mark legend-mark--solid" aria-hidden="true" /> {view.a.name}
      </span>
      <span>
        <span className="legend-mark legend-mark--diamond" aria-hidden="true" /> {view.b.name}
      </span>
    </p>
  )
}

function Row({
  view,
  row,
  measure,
}: {
  view: CompareView
  row: CompareRow
  measure: (typeof MEASURES)[number]['id']
}) {
  const cell = row.cells[measure]
  const higher =
    cell.higher === null
      ? 'No difference to show'
      : `${cell.higher === 'a' ? view.a.name : view.b.name} is higher`
  return (
    <li className="compare-row">
      <p className="compare-row__title">
        {row.title}
        <span className="compare-row__denominator">
          {cell.denominatorText}, {row.periodText}
        </span>
      </p>
      <Dumbbell
        varies={row.kind === 'spend'}
        label={`${row.title}, ${cell.denominatorText}: ${view.a.name} ${cell.a.figure?.text['real-gdp'] ?? 'no value'}, ${view.b.name} ${cell.b.figure?.text['real-gdp'] ?? 'no value'}`}
        a={{
          name: view.a.name,
          value: cell.a.value,
          text: cell.a.figure?.text ?? { 'real-gdp': '', 'real-cpi': '', nominal: '' },
          mark: 'solid',
          derived: cell.a.derived,
        }}
        b={{
          name: view.b.name,
          value: cell.b.value,
          text: cell.b.figure?.text ?? { 'real-gdp': '', 'real-cpi': '', nominal: '' },
          mark: 'diamond',
          derived: cell.b.derived,
        }}
      />
      <p className="compare-row__values tabular">
        <span>
          <FigureText figure={cell.a.figure} />
        </span>
        <span className="compare-row__higher">
          {higher}
          {row.flips ? <span className="compare-row__flip">Depends on how you count</span> : null}
        </span>
        <span>
          <FigureText figure={cell.b.figure} />
        </span>
      </p>
    </li>
  )
}

export function ComparePage({ view, locator }: { view: CompareView; locator: LocatorCells }) {
  return (
    <article className="basis-scope measure-scope compare">
      <header className="dossier-head">
        <div className="dossier-head__text">
          <p className="kicker">
            Compare {view.levelLabel.many} · {view.a.regionName} and {view.b.regionName}
          </p>
          <h1 className="compare__title">
            <a href={view.a.href} style={{ viewTransitionName: `area-${view.a.code}` }}>
              {view.a.name}
            </a>{' '}
            <span className="compare__and">and</span>{' '}
            <a href={view.b.href} style={{ viewTransitionName: `area-${view.b.code}` }}>
              {view.b.name}
            </a>
          </h1>
          <p className="dossier-head__meta">
            {view.a.population} and {view.b.population} residents (mid-2024).
          </p>
          <div className="dossier-head__lede">
            <p>{view.summary}</p>
            <p>
              On {view.flips} of {view.rows.length} measures, which area is higher depends on
              whether you count per person or in total. Choose a way of counting below to see each
              one.
            </p>
          </div>
          <div className="dossier-head__actions">
            <a className="action-link" href={view.swapHref}>
              Swap the two areas
            </a>
          </div>
        </div>
        <div className="dossier-head__locator">
          <HexLocator
            cells={locator.cells}
            selected={[view.a.code, view.b.code]}
            label={`${view.a.name} and ${view.b.name} on a map of the ${view.levelLabel.many} of Great Britain`}
          />
        </div>
      </header>

      <div className="rank-controls">
        <fieldset className="basis-picker">
          <legend className="kicker">How to count</legend>
          <div className="basis-picker__options">
            {MEASURES.map((measure) => (
              <label key={measure.id} className="basis-picker__option">
                <input
                  type="radio"
                  name="measure"
                  value={measure.id}
                  defaultChecked={measure.id === 'group'}
                  className="sr-only"
                />
                <span>{measure.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <BasisPicker priceBase={view.priceBase} />
      </div>

      {MEASURES.map((measure) => (
        <section
          key={measure.id}
          data-measure-panel={measure.id}
          aria-label={measure.label}
          className="compare-panel"
        >
          <header className="compare-panel__head">
            <h2 className="font-display text-title">{measure.label}</h2>
            <p className="compare-panel__tally">
              {view.a.name} is higher on {view.tally[measure.id].a} of {view.tally[measure.id].of}{' '}
              measures, and {view.b.name} on {view.tally[measure.id].b}. Each row has its own scale
              from zero. Money is in <BasisNote priceBase={view.priceBase} />.
              <Refs sources={view.sources.map((source) => source.n)} />
            </p>
            <Key view={view} />
          </header>
          <ol className="compare-rows">
            {view.rows.map((row) => (
              <Row key={row.metric} view={view} row={row} measure={measure.id} />
            ))}
          </ol>
          <NumbersTable
            caption={`${view.a.name} and ${view.b.name}, ${measure.label.toLowerCase()}`}
          >
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">{view.a.name}</th>
                <th scope="col">{view.b.name}</th>
                <th scope="col">Higher</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => {
                const cell = row.cells[measure.id]
                return (
                  <tr key={row.metric}>
                    <th scope="row">
                      {row.title}
                      <span className="ledger-table__sub">
                        {cell.denominatorText}, {row.periodText}
                      </span>
                    </th>
                    <td className="tabular">
                      <FigureText figure={cell.a.figure} />
                      {cell.a.derived ? <Chips kinds={cell.a.kinds} /> : null}
                    </td>
                    <td className="tabular">
                      <FigureText figure={cell.b.figure} />
                      {cell.b.derived ? <Chips kinds={cell.b.kinds} /> : null}
                    </td>
                    <td>
                      {cell.higher === null ? '' : cell.higher === 'a' ? view.a.name : view.b.name}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </NumbersTable>
        </section>
      ))}

      <section aria-labelledby="compare-notes" className="dossier-section">
        <h2 id="compare-notes" className="font-display text-title">
          Sources
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Each area&apos;s page lists the limits of its figures and where each one comes from.
        </p>
        <SourceList sources={view.sources} release={view.release} />
      </section>
    </article>
  )
}
