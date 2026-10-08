/**
 * Explained by age: actual spending against the level modelled from each
 * area's age profile, deprivation and pay. The second step drops every dot
 * by its modelled level, so the diagonal becomes zero, then rescales to the
 * differences. The model's formula is printed beside it, every coefficient.
 *
 * The server renders the frame without dots: the figure reads its values
 * in the browser once it nears the viewport, so the page carries none.
 */
import { scaleLinear } from '@visx/scale'
import { gsap } from 'gsap'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react'
import type { AreaOrderHash, Catalogue, MetricDefinition } from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import { denominatorLabel, type Basis } from '#/domain/measure.ts'
import { dataSource } from '#/data/source.ts'
import { useHydrated } from '#/lib/hydrated.ts'
import { binOf, colourDomain, tokenOf } from '#/viz/colour.ts'
import { basisLabel, LEVEL_LABEL } from '#/content/labels.ts'
import { capitalise } from '#/content/sentences.ts'
import { formatPounds, formatValue } from '#/lib/format.ts'
import { formulaText } from '#/viz/model-formula.ts'
import { MOTION } from '#/viz/motion.ts'
import type { ExpectedFit, ExploreArea, ExploreExpected } from '../load.ts'

const WIDTH = 640
const HEIGHT = 420
const MARGIN = { top: 16, right: 16, bottom: 44, left: 80 }

type Step = 'actual' | 'residual'

const yOf = (domain: readonly [number, number]) =>
  scaleLinear({ domain: [...domain], range: [HEIGHT - MARGIN.bottom, MARGIN.top] })

export interface ScatterPoint {
  readonly area: number
  readonly expected: number
  readonly actual: number
  readonly residual: number
}

/** Areas with an actual and a modelled level; the rest lack an input. */
export function scatterPoints(expected: ExploreExpected): readonly ScatterPoint[] {
  const points: ScatterPoint[] = []
  expected.actual.forEach((actual, area) => {
    const residual = expected.residual[area]
    if (actual === null || residual === null || residual === undefined) return
    points.push({ area, actual, residual, expected: actual - residual })
  })
  return points
}

function ScatterChart({
  expected,
  catalogue,
  level,
  basis,
  areas,
  selected,
  reduced,
}: {
  readonly expected: ExploreExpected
  readonly catalogue: Catalogue
  readonly level: GeoLevel
  readonly basis: Basis
  readonly areas: readonly ExploreArea[]
  readonly selected: number
  readonly reduced: boolean
}) {
  const [step, setStep] = useState<Step>('actual')
  // Each dot's title is for pointer readers in the browser; the server leaves them out to keep the page small.
  const hydrated = useHydrated()
  const circles = useRef<SVGGElement>(null)
  const guide = useRef<SVGLineElement>(null)
  const ticks = useRef<SVGGElement>(null)
  const points = useMemo(() => scatterPoints(expected), [expected])
  const actualMetric: MetricDefinition | undefined = catalogue.metrics.find(
    (m) => m.id === expected.fit.actualMetric,
  )
  const fit = expected.fit.levels[level]
  const residualDomain = colourDomain(
    points.map((p) => p.residual),
    'diverging',
  )

  const empty = points.length === 0
  const extent = useMemo(() => {
    if (points.length === 0) {
      const unit: readonly [number, number] = [0, 1]
      return { x: unit, actual: unit, shared: unit, residual: [-1, 1] as const }
    }
    const values = points.flatMap((p) => [p.expected, p.actual])
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo) * 0.04
    const r = Math.max(...points.map((p) => Math.abs(p.residual))) * 1.08
    const actual: readonly [number, number] = [lo - pad, hi + pad]
    return {
      x: actual,
      actual,
      /** Room for dots at their actual level and at their difference at once. */
      shared: [Math.min(lo - pad, -r), hi + pad] as const,
      residual: [-r, r] as const,
    }
  }, [points])

  const x = scaleLinear({ domain: [...extent.x], range: [MARGIN.left, WIDTH - MARGIN.right] })
  const yActual = yOf(extent.actual)
  const anim = useRef({ drop: 0, zoom: 0 })

  // Dots and the guide are written straight to the DOM each frame; React renders the axes.
  useLayoutEffect(() => {
    const group = circles.current
    const line = guide.current
    const axis = ticks.current
    if (group === null || line === null || axis === null) return undefined
    const nodes = Array.from(group.querySelectorAll<SVGCircleElement>('circle'))
    const state = anim.current
    const mix = (a: readonly [number, number], b: readonly [number, number], t: number) =>
      [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const
    const draw = () => {
      // drop moves dots from actual to actual less modelled; zoom then rescales to the differences.
      const domain = mix(mix(extent.actual, extent.shared, state.drop), extent.residual, state.zoom)
      const y = yOf(domain)
      nodes.forEach((node, i) => {
        const point = points[i]
        if (point !== undefined) {
          node.setAttribute('cy', y(point.actual - point.expected * state.drop).toFixed(1))
        }
      })
      line.setAttribute('y1', y(extent.x[0] * (1 - state.drop)).toFixed(1))
      line.setAttribute('y2', y(extent.x[1] * (1 - state.drop)).toFixed(1))
    }
    const goal = step === 'residual' ? 1 : 0
    if (state.drop === goal && state.zoom === goal) {
      draw()
      return undefined
    }
    const timeline = gsap.timeline({ onUpdate: draw })
    if (reduced) {
      timeline
        .to(group, { opacity: 0, duration: MOTION.fade / 2, ease: 'none' })
        .set(state, { drop: goal, zoom: goal, onComplete: draw })
        .to(group, { opacity: 1, duration: MOTION.fade / 2, ease: 'none' })
    } else {
      const first = goal === 1 ? 'drop' : 'zoom'
      const second = goal === 1 ? 'zoom' : 'drop'
      timeline
        .fromTo(axis, { opacity: 1 }, { opacity: 0, duration: 0.12, ease: 'none' })
        .to(state, {
          [first]: goal,
          duration: first === 'drop' ? MOTION.morph : 0.4,
          ease: 'power2.inOut',
        })
        .to(state, {
          [second]: goal,
          duration: second === 'drop' ? MOTION.morph : 0.4,
          ease: 'power2.inOut',
        })
        .to(axis, { opacity: 1, duration: 0.2, ease: 'none' })
    }
    return () => {
      timeline.kill()
      gsap.set(axis, { opacity: 1 })
    }
  }, [step, points, extent, reduced])

  if (fit === undefined || actualMetric === undefined) return null
  const band = denominatorLabel(expected.fit.denominator, 1)
  const many = LEVEL_LABEL[level].many
  const missing = expected.actual.filter((v) => v !== null).length - points.length
  const format = {
    unit: 'gbp' as const,
    denominator: expected.fit.denominator,
    rateScale: 1 as const,
  }
  const axisTicks = empty ? [] : (step === 'residual' ? yOf(extent.residual) : yActual).ticks(5)
  const yAxis = step === 'residual' ? yOf(extent.residual) : yActual

  return (
    <figure className="viz-hero" aria-labelledby="expected-title">
      <p className="kicker">Compared with similar areas</p>
      <h2 id="expected-title" className="hero-title">
        Is spending higher or lower than expected?
      </h2>
      <p className="hero-lede">
        {actualMetric.label} {band}, {expected.period}. We compare it with the level we would expect
        from each area's share of children and of people aged 66 and over, how deprived it is
        compared with the rest of its nation, and the typical pay of people who live there.{' '}
        {capitalise(basisLabel(basis, catalogue.priceBase))}.
      </p>
      <fieldset className="mt-3">
        <legend className="sr-only">Chart step</legend>
        <div className="seg">
          <button
            type="button"
            className="seg-item"
            aria-pressed={step === 'actual'}
            onClick={() => setStep('actual')}
          >
            Actual and expected
          </button>
          <button
            type="button"
            className="seg-item"
            aria-pressed={step === 'residual'}
            onClick={() => setStep('residual')}
          >
            Difference from expected
          </button>
        </div>
      </fieldset>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-4 w-full"
        aria-labelledby="expected-title"
      >
        <g ref={ticks} className="stage-axis" aria-hidden="true">
          {axisTicks.map((tick) => (
            <g key={tick} transform={`translate(0, ${yAxis(tick)})`}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                stroke="var(--rule)"
                strokeWidth="0.6"
              />
              <text x={MARGIN.left - 8} y={4} textAnchor="end" className="stage-tick">
                {step === 'residual'
                  ? formatValue(tick, format, { sign: true })
                  : formatPounds(tick)}
              </text>
            </g>
          ))}
          {(empty ? [] : x.ticks(5)).map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={HEIGHT - MARGIN.bottom + 18}
              textAnchor="middle"
              className="stage-tick"
            >
              {formatPounds(tick)}
            </text>
          ))}
          <text
            x={(MARGIN.left + WIDTH - MARGIN.right) / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
            className="hero-axis-label"
          >
            Expected level {band}
          </text>
          <text
            x={14}
            y={(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}
            className="hero-axis-label"
            transform={`rotate(-90 14 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2})`}
            textAnchor="middle"
          >
            {step === 'residual' ? 'Above or below expected' : 'Actual'}
          </text>
        </g>
        {empty ? (
          <text
            x={(MARGIN.left + WIDTH - MARGIN.right) / 2}
            y={(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}
            textAnchor="middle"
            className="hero-axis-label"
          >
            {hydrated
              ? "Reading every area's values…"
              : "This chart needs JavaScript. Each area's expected level is on its area page."}
          </text>
        ) : (
          <line
            ref={guide}
            x1={x(extent.x[0]).toFixed(1)}
            x2={x(extent.x[1]).toFixed(1)}
            y1={yActual(extent.x[0]).toFixed(1)}
            y2={yActual(extent.x[1]).toFixed(1)}
            stroke="var(--ink)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
        <g ref={circles} stroke="var(--paper)" strokeWidth="0.5">
          {points.map((point) => (
            <circle
              key={point.area}
              cx={x(point.expected).toFixed(1)}
              cy={yActual(point.actual).toFixed(1)}
              r={point.area === selected ? 5 : 2.6}
              fill={`var(${tokenOf(binOf(point.residual, residualDomain, 'diverging'), 'diverging')})`}
              {...(point.area === selected ? { stroke: 'var(--ink)', strokeWidth: 2 } : {})}
            >
              {hydrated ? (
                <title>
                  {`${areas[point.area]?.name ?? ''}: actual ${formatPounds(point.actual)}, expected ${formatPounds(point.expected)}, difference ${formatValue(point.residual, format, { sign: true })}`}
                </title>
              ) : null}
            </circle>
          ))}
        </g>
      </svg>
      <figcaption className="hero-note">
        <span className="font-mono text-ink">Expected level = {formulaText(fit.terms)}</span>.
        Fitted by ordinary least squares across {fit.observations.toLocaleString('en-GB')} {many}.
        R² = {fit.rSquared.toFixed(2)}. Gold dots are above the expected level and grey dots are
        below it.
        {missing > 0
          ? ` ${missing} ${missing === 1 ? 'area has' : 'areas have'} no expected level because a figure is missing.`
          : ''}
      </figcaption>
    </figure>
  )
}

/** No values yet: the frame draws with its title, controls and formula, and no dots. */
const noValues = (fit: ExpectedFit, catalogue: Catalogue): ExploreExpected => ({
  fit,
  period: catalogue.models.expected.period,
  actual: [],
  residual: [],
  flags: [],
})

function ExpectedScatterImpl({
  fit,
  catalogue,
  level,
  metric,
  basis,
  areaOrderHash,
  areas,
  selected,
  reduced,
}: {
  readonly fit: ExpectedFit
  readonly catalogue: Catalogue
  readonly level: GeoLevel
  readonly metric: MetricDefinition
  readonly basis: Basis
  readonly areaOrderHash: AreaOrderHash
  readonly areas: readonly ExploreArea[]
  readonly selected: number
  readonly reduced: boolean
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const key = `${level}|${fit.metric}|${basis}`
  const [loaded, setLoaded] = useState<{ key: string; expected: ExploreExpected } | undefined>()

  useEffect(() => {
    const element = frame.current
    if (element === null) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return undefined
    let live = true
    import('../load.ts')
      .then(({ loadExpected }) =>
        loadExpected(dataSource(), catalogue, level, metric, basis, areaOrderHash),
      )
      .then((expected) => {
        if (live && expected !== undefined) setLoaded({ key, expected })
      })
      // The frame stays without dots; every area's modelled level is on its area page.
      .catch((error: unknown) => console.warn('Explained by age values unavailable', error))
    return () => {
      live = false
    }
  }, [near, key, catalogue, level, metric, basis, areaOrderHash])

  const expected =
    loaded !== undefined && loaded.key === key ? loaded.expected : noValues(fit, catalogue)
  return (
    <div ref={frame}>
      <ScatterChart
        expected={expected}
        catalogue={catalogue}
        level={level}
        basis={basis}
        areas={areas}
        selected={selected}
        reduced={reduced}
      />
    </div>
  )
}

/** Memoised: loader data keeps its identity across view and selection changes. */
export const ExpectedScatter = memo(ExpectedScatterImpl)
