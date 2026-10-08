/**
 * What changed: one benefit family's annual run rate split into population,
 * claim-rate and award-size effects, for the selected area or Great Britain.
 * The pipeline publishes the inputs; `decompose` runs here for the reader's
 * basis, and the bars add up to the change by construction.
 */
import { scaleBand, scaleLinear } from '@visx/scale'
import { gsap } from 'gsap'
import { useLayoutEffect, useRef, useState, type ReactNode, memo } from 'react'
import { decompose } from '#/domain/decomposition.ts'
import {
  priceFactors,
  type AreaDossier,
  type Catalogue,
  type MetricDefinition,
} from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import { denominatorLabel, type Basis } from '#/domain/measure.ts'
import { Month } from '#/domain/period.ts'
import { basisLabel } from '#/content/labels.ts'
import { capitalise } from '#/content/sentences.ts'
import { formatPounds, periodLabel } from '#/lib/format.ts'
import { MOTION } from '#/viz/motion.ts'
import { EFFECT_LABEL, waterfallBars } from '#/viz/waterfall.ts'

const WIDTH = 640
const HEIGHT = 300
const MARGIN = { top: 28, right: 12, bottom: 44, left: 12 }

type Family = Catalogue['decomposition']['families'][number]

/** Families the metric sums that have published decomposition inputs; every family when it sums none. */
export function familiesFor(catalogue: Catalogue, metric: MetricDefinition): readonly Family[] {
  const all = catalogue.decomposition.families
  const own = all.filter((entry) => metric.families.includes(entry.family))
  return own.length > 0 ? own : all
}

const signed = (value: number) => formatPounds(value, { total: true, sign: true })

function WaterfallImpl({
  catalogue,
  metric,
  level,
  basis,
  areaName,
  inputs,
  reduced,
}: {
  readonly catalogue: Catalogue
  readonly metric: MetricDefinition
  readonly level: GeoLevel
  readonly basis: Basis
  /** The selected area, or undefined for Great Britain. */
  readonly areaName: string | undefined
  readonly inputs: AreaDossier['decomposition'] | undefined
  readonly reduced: boolean
}) {
  const families = familiesFor(catalogue, metric)
  const [chosen, setChosen] = useState(families[0]?.family)
  const entry = families.find((f) => f.family === chosen) ?? families[0]
  const areaInputs = inputs?.find((item) => item.family === entry?.family)
  const source = areaInputs ?? entry?.gb[level]
  const whose = areaInputs === undefined ? 'Great Britain' : (areaName ?? 'Great Britain')
  const effects =
    entry === undefined || source === undefined
      ? undefined
      : decompose(
          source,
          { from: Month.parse(entry.from), to: Month.parse(entry.to) },
          basis,
          priceFactors(catalogue),
        )
  const familyLabel = catalogue.families.find((f) => f.id === entry?.family)?.label ?? ''

  if (entry === undefined) return null
  const title = `What changed: ${familyLabel}`
  const from = periodLabel(entry.from, 'month')
  const to = periodLabel(entry.to, 'month')

  let chart = (
    <p className="mt-4 text-sm text-ink-muted">
      There are no published figures for {whose} for this benefit.
    </p>
  )
  if (effects !== undefined) {
    const list = waterfallBars(effects, { from, to })
    const top = Math.max(...list.map((bar) => Math.max(bar.start, bar.end)))
    const x = scaleBand({
      domain: list.map((bar) => bar.key),
      range: [MARGIN.left, WIDTH - MARGIN.right],
      padding: 0.28,
    })
    const y = scaleLinear({ domain: [0, top * 1.08], range: [HEIGHT - MARGIN.bottom, MARGIN.top] })
    chart = (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-4 w-full" aria-label={title}>
        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--rule-strong)"
        />
        <GrowingBars key={`${entry.family}|${whose}|${basis}`} reduced={reduced}>
          {list.map((bar) => {
            const left = x(bar.key) ?? 0
            const high = Math.max(bar.start, bar.end)
            const low = Math.min(bar.start, bar.end)
            const fill =
              bar.kind === 'total'
                ? 'var(--seq-brass-5)'
                : bar.end >= bar.start
                  ? 'var(--seq-brass-3)'
                  : 'var(--pewter)'
            return (
              <rect
                key={bar.key}
                x={left}
                width={x.bandwidth()}
                y={y(high)}
                height={Math.max(y(low) - y(high), 1)}
                fill={fill}
                data-grow={bar.kind === 'effect' && bar.end < bar.start ? 'down' : 'up'}
              />
            )
          })}
        </GrowingBars>
        {list.map((bar, i) => {
          const left = x(bar.key) ?? 0
          const next = list[i + 1]
          const value =
            bar.kind === 'total'
              ? formatPounds(bar.end, { total: true })
              : signed(bar.end - bar.start)
          return (
            <g key={bar.key}>
              {next !== undefined && bar.key !== 'awardSize' ? (
                <line
                  x1={left + x.bandwidth()}
                  x2={x(next.key) ?? 0}
                  y1={y(bar.end)}
                  y2={y(bar.end)}
                  stroke="var(--rule-strong)"
                  strokeDasharray="2 2"
                />
              ) : null}
              <text
                x={left + x.bandwidth() / 2}
                y={y(Math.max(bar.start, bar.end)) - 7}
                textAnchor="middle"
                className="hero-value"
              >
                {value}
              </text>
              <text
                x={left + x.bandwidth() / 2}
                y={HEIGHT - MARGIN.bottom + 18}
                textAnchor="middle"
                className="hero-axis-label"
              >
                {bar.label}
              </text>
            </g>
          )
        })}
      </svg>
    )
  }

  return (
    <figure className="viz-hero" aria-labelledby="waterfall-title">
      <p className="kicker">What changed</p>
      <h2 id="waterfall-title" className="hero-title">
        More people, more claims or bigger payments?
      </h2>
      <p className="hero-lede">
        {whose}, {familyLabel}: yearly spending at the rate in {from} and in {to}. The chart splits
        the change into three parts: the number of people in the age group, the share of them
        claiming, and the average payment. {capitalise(basisLabel(basis, catalogue.priceBase))}.
      </p>
      {families.length > 1 ? (
        <fieldset className="mt-3">
          <legend className="sr-only">Benefit</legend>
          <div className="seg">
            {families.map((family) => (
              <button
                key={family.family}
                type="button"
                className="seg-item"
                aria-pressed={family.family === entry.family}
                onClick={() => setChosen(family.family)}
              >
                {catalogue.families.find((f) => f.id === family.family)?.label ?? family.family}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {chart}
      {effects === undefined ? null : (
        <table className="sr-only">
          <caption>{title}</caption>
          <tbody>
            <tr>
              <th scope="row">{from}</th>
              <td>{formatPounds(effects.from, { total: true })}</td>
            </tr>
            <tr>
              <th scope="row">{EFFECT_LABEL.population}</th>
              <td>{signed(effects.population)}</td>
            </tr>
            <tr>
              <th scope="row">{EFFECT_LABEL.claimRate}</th>
              <td>{signed(effects.claimRate)}</td>
            </tr>
            <tr>
              <th scope="row">{EFFECT_LABEL.awardSize}</th>
              <td>{signed(effects.awardSize)}</td>
            </tr>
            <tr>
              <th scope="row">{to}</th>
              <td>{formatPounds(effects.to, { total: true })}</td>
            </tr>
          </tbody>
        </table>
      )}
      <figcaption className="hero-note">
        The share claiming is the number of{' '}
        {entry.claimantUnit === 'households' ? 'households claiming' : 'people claiming'}{' '}
        {denominatorLabel(entry.denominator, 1)}. Yearly spending here is the number claiming, times
        the average weekly payment, times 52. It is not the amount paid out over the year.
        Population after mid-2024 stays at the mid-2024 figure, so later growth shows in the share
        claiming.
        {entry.nations.length < 3
          ? ' Scottish areas are left out because Social Security Scotland pays this benefit.'
          : ''}
        {inputs !== undefined && areaInputs === undefined && areaName !== undefined
          ? ` ${areaName} has no figures for this benefit, so Great Britain is shown.`
          : ''}
      </figcaption>
    </figure>
  )
}

/** Bars that grow from their base in order, once per mount: new inputs remount them. */
function GrowingBars({
  reduced,
  children,
}: {
  readonly reduced: boolean
  readonly children: ReactNode
}) {
  const group = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    const element = group.current
    if (element === null) return undefined
    const rects = Array.from(element.querySelectorAll('rect'))
    const context = gsap.context(() => {
      if (reduced) {
        gsap.fromTo(rects, { opacity: 0 }, { opacity: 1, duration: MOTION.fade, ease: 'none' })
        return
      }
      rects.forEach((rect, i) => {
        const y = Number(rect.getAttribute('y'))
        const height = Number(rect.getAttribute('height'))
        const down = rect.dataset['grow'] === 'down'
        gsap.fromTo(
          rect,
          { attr: { y: down ? y : y + height, height: 0 } },
          { attr: { y, height }, duration: 0.42, ease: 'power2.out', delay: i * 0.12 },
        )
      })
    }, element)
    return () => context.revert()
  }, [reduced])
  return <g ref={group}>{children}</g>
}

/** Memoised: loader data keeps its identity across view and selection changes. */
export const Waterfall = memo(WaterfallImpl)
