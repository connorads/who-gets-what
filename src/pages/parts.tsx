/**
 * Building blocks for pages rendered to static markup on the server. They take
 * no event handlers: behaviour comes from `src/lib/enhance.ts` and CSS, so the
 * browser downloads no page code for them.
 */
import type { ReactNode } from 'react'
import { perBasis, type Figure, type PerBasis } from '#/content/figures.ts'
import {
  BASES,
  BASIS_CHOICE,
  basisExplained,
  basisLabel,
  PROVENANCE_LABEL,
} from '#/content/labels.ts'
import type { SourceNote } from '#/content/sources.ts'
import type { Basis, ProvenanceKind } from '#/domain/measure.ts'
import { formatDate } from '#/lib/format.ts'

/** Text in every basis; CSS shows the one the reader picked. */
export function BasisText({ text, varies }: { text: PerBasis<string>; varies: boolean }) {
  if (!varies) return <>{text['real-gdp']}</>
  return (
    <>
      {BASES.map((basis) => (
        <span key={basis} data-basis={basis}>
          {text[basis]}
        </span>
      ))}
    </>
  )
}

export function FigureText({
  figure,
  empty = 'No value',
}: {
  figure: Figure | null
  empty?: string
}) {
  return figure === null ? <>{empty}</> : <BasisText text={figure.text} varies={figure.varies} />
}

/**
 * The price basis note beside money figures, in the reader's basis.
 * `explained` says what the prices mean, for the first note on a page.
 */
export function BasisNote({ priceBase, explained }: { priceBase: string; explained?: boolean }) {
  const label = explained === true ? basisExplained : basisLabel
  return <BasisText text={perBasis((basis) => label(basis, priceBase))} varies />
}

/**
 * The basis switch: three radios that CSS reads with `:has()`, so a static page
 * changes basis without script. `data-basis-picker` lets the enhancer keep the
 * choice across pages.
 */
export function BasisPicker({ priceBase }: { priceBase: string }) {
  return (
    <fieldset className="basis-picker" data-basis-picker="">
      <legend className="kicker">Prices</legend>
      <div className="basis-picker__options">
        {BASES.map((basis: Basis) => (
          <label key={basis} className="basis-picker__option">
            <input
              type="radio"
              name="basis"
              value={basis}
              defaultChecked={basis === 'real-gdp'}
              className="sr-only"
            />
            <span>{BASIS_CHOICE[basis]}</span>
          </label>
        ))}
      </div>
      <p className="basis-picker__note">
        Money in <BasisNote priceBase={priceBase} explained />.
      </p>
    </fieldset>
  )
}

/** Provenance chips: measured values get a plain chip, derived values the halftone. */
export function Chips({ kinds }: { kinds: readonly ProvenanceKind[] }) {
  return (
    <span className="chips">
      {kinds.map((kind) => (
        <span key={kind} className={`chip chip--${kind}`}>
          {PROVENANCE_LABEL[kind]}
        </span>
      ))}
    </span>
  )
}

/** Footnote numbers as runs: `[1, 2, 3, 5]` reads "1-3, 5". */
export function refRuns(sources: readonly number[]): string {
  const sorted = [...new Set(sources)].toSorted((a, b) => a - b)
  const runs: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? 0) + 1) j += 1
    runs.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]))
    i = j + 1
  }
  return runs.join(', ')
}

/** Footnote references to the page's source list, as one link. */
export function Refs({ sources }: { sources: readonly number[] }) {
  const first = sources.toSorted((a, b) => a - b)[0]
  if (first === undefined) return null
  const runs = refRuns(sources)
  return (
    <sup className="refs">
      <a href={`#source-${first}`} aria-label={`Sources ${runs}`}>
        {runs}
      </a>
    </sup>
  )
}

/** Every chart's numbers as an HTML table, closed by default. */
export function NumbersTable({
  caption,
  children,
  open = false,
}: {
  caption: string
  children: ReactNode
  open?: boolean
}) {
  return (
    <details className="numbers" open={open}>
      <summary>Show the numbers</summary>
      <div className="numbers__scroll">
        <table className="ledger-table">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </details>
  )
}

export function Section({
  id,
  kicker,
  title,
  intro,
  children,
}: {
  id: string
  kicker: string
  title: string
  intro?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="dossier-section">
      <header className="dossier-section__head">
        <p className="kicker">{kicker}</p>
        <h2 id={`${id}-title`} className="mt-2 font-display text-title text-balance">
          {title}
        </h2>
        {intro === undefined ? null : <div className="dossier-section__intro">{intro}</div>}
      </header>
      <div className="dossier-section__body">{children}</div>
    </section>
  )
}

export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="caveat">
      <span className="caveat__mark" aria-hidden="true">
        ※
      </span>
      <span>{children}</span>
    </p>
  )
}

export function SourceList({
  sources,
  release,
}: {
  sources: readonly SourceNote[]
  release: string
}) {
  return (
    <ol className="source-list">
      {sources.map((source) => (
        <li key={source.id} id={`source-${source.n}`}>
          <span className="source-list__n tabular">{source.n}</span>
          <span>
            {source.publisher}.{' '}
            <a href={source.url} rel="noopener">
              {source.title}
            </a>
            . Published {formatDate(source.published)}. {source.licence}. Data release {release}.
          </span>
        </li>
      ))}
    </ol>
  )
}

/** A horizontal bar as a share of its track; colour comes from `className` or `color`. */
export function ShareBar({
  share,
  color,
  className,
  derived = false,
}: {
  share: number
  color?: string
  className?: string
  derived?: boolean
}) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`
  return (
    <span className={`share-bar ${className ?? ''}`} aria-hidden="true">
      <span
        className={`share-bar__fill${derived ? ' halftone' : ''}`}
        style={{ width, ...(color === undefined ? {} : { background: color }) }}
      />
    </span>
  )
}

/** Bars in every basis on one shared scale. */
export function BasisBar({
  values,
  max,
  varies,
  color,
  className,
  derived = false,
}: {
  values: PerBasis<number> | null
  max: number
  varies: boolean
  color?: string
  className?: string
  derived?: boolean
}) {
  if (values === null) return <span className="share-bar share-bar--empty" aria-hidden="true" />
  const bases = varies ? BASES : (['real-gdp'] as const)
  return (
    <>
      {bases.map((basis) => (
        <span key={basis} data-basis={varies ? basis : undefined} className="contents">
          <ShareBar
            share={max > 0 ? values[basis] / max : 0}
            derived={derived}
            {...(color === undefined ? {} : { color })}
            {...(className === undefined ? {} : { className })}
          />
        </span>
      ))}
    </>
  )
}
